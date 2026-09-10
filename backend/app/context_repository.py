"""Immutable conversation nodes. Only an ancestor of the committed head is memory."""

import hashlib
import json
from . import storage as s


def initialize(q):
    q.execute("""CREATE TABLE IF NOT EXISTS context_nodes (
      id CHAR(64) PRIMARY KEY,run_id VARCHAR(120),agent_id INT,parent CHAR(64),seq BIGINT,
      payload LONGBLOB, KEY actor_nodes(run_id,agent_id), KEY parent_node(parent))""")
    q.execute(
        "CREATE TABLE IF NOT EXISTS context_knowledge (id CHAR(64) PRIMARY KEY,payload LONGBLOB)"
    )
    q.execute(
        "CREATE TABLE IF NOT EXISTS context_prepared (id CHAR(64) PRIMARY KEY,payload LONGBLOB)"
    )
    q.execute("""CREATE TABLE IF NOT EXISTS context_memory (
      node_id CHAR(64),memory_key CHAR(64),day INT,source VARCHAR(20),content TEXT,
      importance INT,speaker INT,PRIMARY KEY(node_id,memory_key))""")


def get(node_id):
    if not node_id:
        return None
    with s.transaction() as q:
        q.execute("SELECT payload FROM context_nodes WHERE id=%s", (node_id,))
        r = q.fetchone()
        return s.decode(r["payload"]) if r else None


def preparation(key, value=None):
    with s.transaction() as q:
        if value is not None:
            q.execute(
                "INSERT IGNORE INTO context_prepared VALUES (%s,%s)",
                (key, s.encode(value)),
            )
        q.execute("SELECT payload FROM context_prepared WHERE id=%s", (key,))
        r = q.fetchone()
        return s.decode(r["payload"]) if r else None


def insert(q, node):
    node = dict(node)
    knowledge = node.pop("knowledgePayload", None)
    if knowledge is not None:
        key = hashlib.sha256(
            json.dumps(
                knowledge, sort_keys=True, ensure_ascii=False, separators=(",", ":")
            ).encode()
        ).hexdigest()
        if key != node.get("knowledgeHash"):
            raise ValueError("Knowledge hash mismatch")
        q.execute(
            "INSERT IGNORE INTO context_knowledge VALUES (%s,%s)",
            (key, s.encode(knowledge)),
        )
    q.execute("SELECT payload FROM context_nodes WHERE id=%s", (node["id"],))
    old = q.fetchone()
    if old:
        if s.decode(old["payload"]) != node:
            raise ValueError("Conflicting immutable context node")
        return
    q.execute(
        "INSERT INTO context_nodes VALUES (%s,%s,%s,%s,%s,%s)",
        (
            node["id"],
            node["runId"],
            node["agentId"],
            node.get("parent"),
            node["seq"],
            s.encode(node),
        ),
    )
    for m in node.get("memories", []):
        content = m.get("content") or m.get("text", "")
        if not content:
            continue
        key = hashlib.sha256((str(m.get("id", "")) + content).encode()).hexdigest()
        q.execute(
            "INSERT IGNORE INTO context_memory VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (
                node["id"],
                key,
                m.get("day", 0),
                m.get("source", "heard"),
                content,
                m.get("importance", 3),
                m.get("speakerId"),
            ),
        )


def save(node):
    with s.transaction() as q:
        insert(q, node)


def messages(head):
    """Read just this context epoch. Epoch roots retain ancestry for long-term retrieval."""
    parts = []
    seen = set()
    scope = None
    while head:
        if head in seen:
            raise ValueError("Cycle in context ancestry")
        seen.add(head)
        node = get(head)
        if node is None:
            raise ValueError("Context history is missing; import its context nodes")
        current = (node["runId"], node["agentId"])
        if scope is not None and scope != current:
            raise ValueError("Foreign context ancestor")
        scope = current
        parts.append(node["append"])
        if node.get("base") is not None:
            return node["base"] + [m for part in reversed(parts) for m in part]
        head = node.get("parent")
    return [m for part in reversed(parts) for m in part]


def recall(head, context, experiment=None, run_id=None):
    actor = context["self"]["id"]
    day = context["day"]
    seq = context["seq"]
    people = context.get("people", [])
    query = " ".join(
        [
            context.get("recallQuery") or "",
            str(context["self"].get("goal") or ""),
            *[p["name"] for p in people],
        ]
    )
    import re

    terms = list(
        dict.fromkeys(re.findall(r"[\u4e00-\u9fff]{2,6}|[A-Za-z_]{3,}", query))
    )[:12]
    # Include short Chinese substrings so multiword questions can match old testimony.
    terms = list(
        dict.fromkeys(
            terms
            + [
                t[i : i + 2]
                for t in terms
                for i in range(len(t) - 1)
                if "\u4e00" <= t[i] <= "\u9fff"
            ]
        )
    )[:30]
    candidates = []
    if experiment:
        checkpoint = s.checkpoint(experiment)["world"]
        if checkpoint["id"] != run_id or seq > checkpoint["seq"]:
            raise ValueError("Memory scope does not match committed experiment")
        with s.transaction() as q:
            clauses = ""
            args = [experiment, actor, seq]
            if terms:
                clauses = (
                    " AND ("
                    + " OR ".join(["LOCATE(%s,searchable)>0"] * len(terms))
                    + ")"
                )
                args += terms
            q.execute(
                "SELECT payload FROM experiences WHERE experiment=%s AND agent_id=%s AND seq<=%s"
                + clauses
                + " ORDER BY id DESC LIMIT 120",
                args,
            )
            candidates.extend(json.loads(r["payload"]) for r in q.fetchall())
    if head:
        with s.transaction() as q:
            q.execute("SET SESSION cte_max_recursion_depth=10000")
            condition = (
                (
                    " WHERE ("
                    + " OR ".join(["LOCATE(%s,m.content)>0"] * len(terms))
                    + ")"
                )
                if terms
                else ""
            )
            q.execute(
                """WITH RECURSIVE lineage AS (
              SELECT id,parent FROM context_nodes WHERE id=%s AND run_id=%s AND agent_id=%s
              UNION ALL SELECT n.id,n.parent FROM context_nodes n JOIN lineage l ON n.id=l.parent
              WHERE n.run_id=%s AND n.agent_id=%s)
              SELECT m.* FROM context_memory m JOIN lineage l ON m.node_id=l.id
              """
                + condition
                + " ORDER BY m.importance DESC,m.day DESC LIMIT 180",
                [head, run_id, actor, run_id, actor, *terms],
            )
            candidates.extend(q.fetchall())
    unique = {}
    for m in candidates:
        text = m.get("content", "")
        key = (text, m.get("day"), m.get("source"))
        if m.get("day", 0) > day:
            continue
        score = (
            2 * sum(t.lower() in text.lower() for t in terms)
            + m.get("importance", 3)
            + 1 / (1 + max(0, day - m.get("day", 0)))
        )
        unique[key] = (score, m)
    return [m for _, m in sorted(unique.values(), key=lambda x: x[0], reverse=True)[:6]]


def export_nodes(q, heads):
    seen = set()
    libraries = set()
    stack = [h for h in heads if h]
    while stack:
        h = stack.pop()
        if h in seen:
            continue
        seen.add(h)
        q.execute("SELECT payload FROM context_nodes WHERE id=%s", (h,))
        r = q.fetchone()
        if not r:
            raise ValueError("Cannot export missing conversation node")
        node = s.decode(r["payload"])
        key = node.get("knowledgeHash")
        if key and key not in libraries:
            q.execute("SELECT payload FROM context_knowledge WHERE id=%s", (key,))
            knowledge = q.fetchone()
            if not knowledge:
                raise ValueError("Missing protected knowledge catalog")
            node["knowledgePayload"] = s.decode(knowledge["payload"])
            libraries.add(key)
        yield node
        if node.get("parent"):
            stack.append(node["parent"])


def save_knowledge(library):
    key = hashlib.sha256(
        json.dumps(
            library, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()
    with s.transaction() as q:
        q.execute(
            "INSERT IGNORE INTO context_knowledge VALUES (%s,%s)",
            (key, s.encode(library)),
        )
    return key


def validate_ancestry(q, heads, run_id):
    """Validate the full lineage, including older compressed epochs, before import commits."""
    done = set()
    for head in heads:
        path = set()
        child = None
        while head and head not in done:
            if head in path:
                raise ValueError("Cycle in context ancestry")
            path.add(head)
            q.execute("SELECT payload FROM context_nodes WHERE id=%s", (head,))
            row = q.fetchone()
            if not row:
                raise ValueError("Missing context ancestor")
            node = s.decode(row["payload"])
            if node["runId"] != run_id or (child and (
                node["agentId"] != child["agentId"] or node["seq"] > child["seq"]
            )):
                raise ValueError("Invalid context ancestry")
            if node.get("knowledgeHash"):
                q.execute("SELECT id FROM context_knowledge WHERE id=%s", (node["knowledgeHash"],))
                if not q.fetchone():
                    raise ValueError("Missing protected knowledge catalog")
            parent = node.get("parent")
            # Check the edge even when its parent was validated by another branch.
            if parent and parent in done:
                q.execute("SELECT run_id,agent_id,seq FROM context_nodes WHERE id=%s", (parent,))
                p = q.fetchone()
                if p["run_id"] != run_id or p["agent_id"] != node["agentId"] or p["seq"] > node["seq"]:
                    raise ValueError("Invalid context ancestry")
            child, head = node, parent
        done.update(path)
