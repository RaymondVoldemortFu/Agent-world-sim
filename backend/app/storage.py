"""Transactional MySQL archive. Event sequence is an idempotent commit boundary."""

import json
import os
import re
import zlib
from contextlib import contextmanager
from pathlib import Path
import pymysql
from dotenv import load_dotenv
from .replay_delta import event_delta, apply

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
EVENT_NAMES = json.loads((ROOT / "shared/event-names.json").read_text())
BASIC = {"eat", "drink", "wait", "move", "look", "observe", "drop", "discard"}
FOOD = {
    "food",
    "berries",
    "roots",
    "nuts",
    "grain",
    "fish",
    "meat",
    "water",
    "pulses",
    "winter_grain",
}


def encode(value):
    return zlib.compress(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode(), 3
    )


def decode(blob):
    return json.loads(zlib.decompress(blob))


def connect():
    return pymysql.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "agent_world_app"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "agent_world_sim"),
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=5,
        read_timeout=120,
        write_timeout=120,
        cursorclass=pymysql.cursors.DictCursor,
    )


@contextmanager
def transaction():
    db = connect()
    try:
        with db.cursor() as q:
            yield q
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def initialize_schema():
    statements = [
        """CREATE TABLE IF NOT EXISTS experiments (
       name VARCHAR(100) PRIMARY KEY, seq BIGINT NOT NULL, day INT, days INT, population INT, alive INT,
       model VARCHAR(160), complete BOOLEAN, state VARCHAR(20) NOT NULL DEFAULT 'ready',
       checkpoint LONGBLOB NOT NULL, adapter LONGBLOB NOT NULL, metadata JSON,
       updated TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6))""",
        """CREATE TABLE IF NOT EXISTS events (
       experiment VARCHAR(100), seq BIGINT, day INT, type VARCHAR(60), actor_id INT,
       decision_id VARCHAR(220), searchable TEXT, payload JSON,
       PRIMARY KEY(experiment,seq), KEY event_type_seq(experiment,type,seq),
       KEY decision_ref(experiment,decision_id))""",
        """CREATE TABLE IF NOT EXISTS experiences (
       id BIGINT AUTO_INCREMENT PRIMARY KEY, experiment VARCHAR(100), agent_id INT, memory_id VARCHAR(220),
       seq BIGINT, day INT, source VARCHAR(20), searchable TEXT, payload JSON,
       UNIQUE KEY memory_identity(experiment,agent_id,memory_id),
       KEY agent_cursor(experiment,agent_id,id), KEY source_cursor(experiment,agent_id,source,id))""",
        """CREATE TABLE IF NOT EXISTS action_time (
       experiment VARCHAR(100), agent_id INT, day INT, action VARCHAR(60), source VARCHAR(30),
       basic BOOLEAN, minutes DOUBLE NOT NULL DEFAULT 0, starts INT NOT NULL DEFAULT 0,
       completed INT NOT NULL DEFAULT 0, failures INT NOT NULL DEFAULT 0,
       PRIMARY KEY(experiment,agent_id,day,action,source))""",
        """CREATE TABLE IF NOT EXISTS agent_usage (
       experiment VARCHAR(100), agent_id INT, day INT, calls INT, input_tokens BIGINT, output_tokens BIGINT,
       PRIMARY KEY(experiment,agent_id,day))""",
        """CREATE TABLE IF NOT EXISTS decisions (
       experiment VARCHAR(100), id VARCHAR(220), payload LONGBLOB, PRIMARY KEY(experiment,id))""",
        """CREATE TABLE IF NOT EXISTS pending (
       experiment VARCHAR(100), id VARCHAR(220), payload LONGBLOB, PRIMARY KEY(experiment,id))""",
        """CREATE TABLE IF NOT EXISTS snapshots (
       experiment VARCHAR(100), seq BIGINT, day INT, payload LONGBLOB, PRIMARY KEY(experiment,seq))""",
        """CREATE TABLE IF NOT EXISTS replay_events (
       experiment VARCHAR(100), seq BIGINT, day INT, delta LONGBLOB, PRIMARY KEY(experiment,seq))""",
        """CREATE TABLE IF NOT EXISTS migrations (
       experiment VARCHAR(100) PRIMARY KEY, verified BOOLEAN, manifest JSON, verified_at TIMESTAMP NULL)""",
    ]
    with transaction() as q:
        for statement in statements:
            q.execute(statement)
        from .context_repository import initialize

        initialize(q)


def exists(name):
    with transaction() as q:
        q.execute(
            "SELECT name FROM experiments WHERE name=%s AND state='ready'", (name,)
        )
        return bool(q.fetchone())


def checkpoint(name):
    with transaction() as q:
        q.execute(
            "SELECT checkpoint FROM experiments WHERE name=%s AND state='ready'",
            (name,),
        )
        row = q.fetchone()
        if row:
            return decode(row["checkpoint"])
        raise KeyError(name)


def listing():
    with transaction() as q:
        q.execute(
            "SELECT name,day,days,population,alive,model,complete,UNIX_TIMESTAMP(updated) updated FROM experiments WHERE state='ready' ORDER BY updated DESC"
        )
        return q.fetchall()


def adapter_for(world):
    return {
        "agents": {
            str(a["id"]): {"ap": a["ap"], "dead": bool(a.get("death"))}
            for a in world["agents"]
        },
        "pending": {},
    }


def create(name, checkpoint_data, metadata=None, state="ready"):
    w = checkpoint_data["world"]
    with transaction() as q:
        q.execute(
            "INSERT INTO experiments(name,seq,day,days,population,alive,model,complete,state,checkpoint,adapter,metadata) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                name,
                w["seq"],
                len(w["metrics"]),
                w["config"]["days"],
                w["config"]["population"],
                sum(not a.get("death") for a in w["agents"]),
                w["usage"].get("model", ""),
                w["cursor"]["phase"] == "complete",
                state,
                encode(checkpoint_data),
                encode(adapter_for(w)),
                json.dumps(metadata or {}),
            ),
        )
        q.execute(
            "INSERT INTO snapshots VALUES (%s,%s,%s,%s)",
            (name, w["seq"], w["tick"], encode(checkpoint_data)),
        )


def basic_action(action, op, source):
    return op in BASIC or (
        op in ("collect", "gather", "take", "transfer")
        and (action.get("item") or action.get("resource")) in FOOD
        and source in ("rule", "fallback", "legacy")
    )


def rollup(
    q, name, actor, day, op, source, basic, minutes=0, starts=0, completed=0, failures=0
):
    q.execute(
        """INSERT INTO action_time VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE minutes=minutes+VALUES(minutes),starts=starts+VALUES(starts),
        completed=completed+VALUES(completed),failures=failures+VALUES(failures)""",
        (
            name,
            actor,
            day,
            op,
            source,
            basic,
            max(0, minutes),
            starts,
            completed,
            failures,
        ),
    )


def ingest_event(q, name, e, adapter, record=None):
    patch = e.get("patch", {})
    meta = patch.get("meta", {})
    ecology = meta.get("ecology")
    changes = [(a, a.get("memories", [])) for a in patch.get("agents", [])]
    changes += [
        (c["state"], c.get("memories", {}).get("append", []))
        for c in patch.get("agentChanges", [])
    ]
    actor = next((a for a, _ in changes if a["id"] == e.get("actorId")), None)
    base_id = e["decisionId"].removesuffix(":complete")
    action = (record or {}).get("decision", {}).get("action", {})
    op = action.get("op") or action.get("type") or e["type"]
    source = (record or {}).get("source") or (actor or {}).get("brain", {}).get(
        "source", "legacy"
    )
    basic = False
    retained = True
    if e["type"] == "action_started":
        pending = next(
            (
                p
                for p in (ecology or {}).get("pending", [])
                if p["id"] == e["decisionId"]
            ),
            None,
        )
        if not pending:
            raise ValueError("Scheduled action missing from start event")
        action = pending["decision"]["action"]
        op = action.get("op") or action["type"]
        basic = basic_action(action, op, source)
        minutes = pending["at"] - ecology["clock"]
        entry = {
            "actor": e["actorId"],
            "day": e["day"],
            "op": op,
            "source": source,
            "basic": basic,
        }
        adapter["pending"][base_id] = entry
        rollup(q, name, e["actorId"], e["day"], op, source, basic, minutes, 1)
        retained = False
    elif base_id in adapter["pending"]:
        entry = adapter["pending"].pop(base_id)
        basic = entry["basic"]
        op = entry["op"]
        rollup(
            q,
            name,
            entry["actor"],
            entry["day"],
            op,
            entry["source"],
            basic,
            completed=1,
            failures=int(not e["success"]),
        )
        retained = not basic
    elif actor and e["type"] not in (
        "reflection",
        "day_end",
        "config_changed",
        "recovery",
    ):
        # Legacy actions charge AP immediately; action deltas provide their actual cost.
        previous = adapter["agents"].get(str(actor["id"]), {})
        ap_cost = max(0, previous.get("ap", actor["ap"]) - actor["ap"])
        if actor.get("death"):
            ap_cost = min(ap_cost, 2 if op in ("shout", "survey") else 1)
        minutes = ap_cost * 120
        basic = basic_action(action, op, source)
        rollup(
            q,
            name,
            actor["id"],
            e["day"],
            op,
            source,
            basic,
            minutes,
            1,
            1,
            int(not e["success"]),
        )
        retained = not basic
    deaths = [
        a
        for a, _ in changes
        if a.get("death") and not adapter["agents"].get(str(a["id"]), {}).get("dead")
    ]
    for a, _ in changes:
        adapter["agents"][str(a["id"])] = {"ap": a["ap"], "dead": bool(a.get("death"))}
    event = {k: v for k, v in e.items() if k != "patch"}
    if not retained and deaths:
        retained = True
        event = {
            **event,
            "type": "death",
            "text": "；".join(
                f"{a['name']} #{a['id']} 死亡：{a['death']['cause']}" for a in deaths
            ),
        }
    if not retained:
        event["text"] = f"#{e.get('actorId', '')} {op}"
        event["basic"] = basic
    if action:
        event["action"] = action
    position = ",".join(map(str, event.get("position") or []))
    searchable = " ".join(
        [event["text"], event["type"], EVENT_NAMES.get(event["type"], ""), position]
    ).lower()
    q.execute(
        "INSERT INTO events VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            name,
            e["seq"],
            e["day"],
            event["type"],
            e.get("actorId"),
            base_id,
            searchable,
            json.dumps(event, ensure_ascii=False),
        ),
    )
    # Routine event observations are not copied into the searchable history.
    if retained and not basic:
        for a, memories in changes:
            for m in memories:
                # Full legacy patches repeat older memories. Keep only newly created entries.
                if m.get("eventIds") and max(m["eventIds"]) > e["seq"]:
                    continue
                if e["seq"] not in m.get("eventIds", []) and not m["id"].startswith(
                    ("reflection-", "claim-")
                ):
                    continue
                payload = {
                    **m,
                    "agentId": a["id"],
                    "seq": e["seq"],
                    "eventType": event["type"],
                    "decisionId": e["decisionId"],
                    "position": e.get("position"),
                }
                q.execute(
                    "INSERT IGNORE INTO experiences(experiment,agent_id,memory_id,seq,day,source,searchable,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        name,
                        a["id"],
                        m["id"],
                        e["seq"],
                        m["day"],
                        m["source"],
                        m["content"].lower(),
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )
    return not basic and (retained or e["type"] == "action_started")


def ingest_record(q, name, r, keep):
    attempts = r.get("attempts", [])
    q.execute(
        """INSERT INTO agent_usage VALUES (%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE
      calls=calls+VALUES(calls),input_tokens=input_tokens+VALUES(input_tokens),output_tokens=output_tokens+VALUES(output_tokens)""",
        (
            name,
            r["agentId"],
            r["day"],
            len(attempts),
            sum(a.get("usage", {}).get("prompt_tokens", 0) for a in attempts),
            sum(a.get("usage", {}).get("completion_tokens", 0) for a in attempts),
        ),
    )
    # Actions remain inspectable. Model prompts are kept only when an API was used.
    item = {**r}
    item.pop("brainContext", None)
    if attempts and r.get("brainContext"):
        item["context"] = r["brainContext"]
    if not attempts:
        item["context"] = {}
        item["contextPruned"] = True
    if item.get("decision"):
        item["decision"] = {
            k: v for k, v in item["decision"].items() if k != "brainUpdate"
        }
    q.execute("INSERT INTO decisions VALUES (%s,%s,%s)", (name, r["id"], encode(item)))
    q.execute("DELETE FROM pending WHERE experiment=%s AND id=%s", (name, r["id"]))


def commit(name, expected, checkpoint_data, entries):
    w = checkpoint_data["world"]
    target = w["seq"]
    with transaction() as q:
        q.execute(
            "SELECT seq,adapter,checkpoint FROM experiments WHERE name=%s FOR UPDATE",
            (name,),
        )
        old = q.fetchone()
        if not old:
            raise KeyError(name)
        if old["seq"] == target:
            if decode(old["checkpoint"])["world"] != w:
                raise ValueError("Conflicting retry checkpoint")
            return {"seq": target, "duplicate": True}
        if old["seq"] != expected:
            raise ValueError("Checkpoint sequence conflict")
        adapter = decode(old["adapter"])
        replay_world = decode(old["checkpoint"])["world"]
        for i, entry in enumerate(entries):
            e = entry["event"]
            r = entry.get("record")
            if e["seq"] != expected + i + 1:
                raise ValueError("Non-contiguous commit")
            keep = ingest_event(q, name, e, adapter, r)
            delta = event_delta(replay_world, e)
            q.execute(
                "INSERT INTO replay_events VALUES (%s,%s,%s,%s)",
                (name, e["seq"], e["day"], encode(delta)),
            )
            if r:
                ingest_record(q, name, r, keep)
        if target != expected + len(entries):
            raise ValueError("Checkpoint boundary mismatch")
        if replay_world != w:
            raise ValueError("Checkpoint differs from replayed deltas")
        q.execute(
            "UPDATE experiments SET seq=%s,day=%s,alive=%s,model=%s,complete=%s,checkpoint=%s,adapter=%s WHERE name=%s",
            (
                target,
                len(w["metrics"]),
                sum(not a.get("death") for a in w["agents"]),
                w["usage"].get("model", ""),
                w["cursor"]["phase"] == "complete",
                encode(checkpoint_data),
                encode(adapter),
                name,
            ),
        )
        if any(x["event"]["type"] == "day_end" for x in entries):
            q.execute(
                "INSERT INTO snapshots VALUES (%s,%s,%s,%s)",
                (name, target, w["tick"], encode(checkpoint_data)),
            )
    return {"seq": target}


def save_pending(name, record):
    with transaction() as q:
        q.execute(
            "INSERT INTO pending VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE payload=VALUES(payload)",
            (name, record["id"], encode(record)),
        )


def load_pending(name, record_id):
    if record_id is not None:
        return blob_record("pending", name, record_id)
    with transaction() as q:
        q.execute("SELECT payload FROM pending WHERE experiment=%s", (name,))
        return [decode(r["payload"]) for r in q.fetchall()]


def blob_record(table, name, record_id):
    with transaction() as q:
        q.execute(
            f"SELECT payload FROM {table} WHERE experiment=%s AND id=%s",
            (name, record_id),
        )
        r = q.fetchone()
        return decode(r["payload"]) if r else None


def set_metadata(name, key, value):
    with transaction() as q:
        q.execute("SELECT metadata FROM experiments WHERE name=%s FOR UPDATE", (name,))
        r = q.fetchone()
        metadata = json.loads(r["metadata"] or "{}")
        if key == "implementation-append":
            history = metadata.setdefault("implementation", [])
            if value not in history:
                history.append(value)
        else:
            metadata[key] = value
        q.execute(
            "UPDATE experiments SET metadata=%s WHERE name=%s",
            (json.dumps(metadata), name),
        )


def metadata(name, key):
    with transaction() as q:
        q.execute("SELECT metadata FROM experiments WHERE name=%s", (name,))
        r = q.fetchone()
        return json.loads(r["metadata"] or "{}").get(key, {}) if r else {}


def search(name, qtext="", event_type="", limit=120, through=None, before=None):
    with transaction() as q:
        q.execute("SELECT seq FROM experiments WHERE name=%s", (name,))
        boundary = q.fetchone()["seq"]
        boundary = min(boundary, through) if through is not None else boundary
        upper = min(boundary, before - 1) if before is not None else boundary
        clauses = ["experiment=%s", "seq<=%s"]
        args = [name, upper]
        for condition, value in [
            ("type=%s", event_type or None),
            ("LOCATE(%s,searchable)>0", qtext.strip().lower() or None),
        ]:
            if value is not None:
                clauses.append(condition)
                args.append(value)
        q.execute(
            "SELECT payload FROM events WHERE "
            + " AND ".join(clauses)
            + " ORDER BY seq DESC LIMIT %s",
            [*args, limit + 1],
        )
        rows = q.fetchall()
    events = [json.loads(r["payload"]) for r in rows[:limit]]
    return {
        "events": events,
        "hasMore": len(rows) > limit,
        "nextCursor": events[-1]["seq"] if len(rows) > limit else None,
        "through": boundary,
    }


def experiences(
    name,
    agent_id,
    qtext="",
    source="",
    start_day=None,
    end_day=None,
    limit=60,
    through=None,
    before=None,
):
    with transaction() as q:
        q.execute("SELECT seq FROM experiments WHERE name=%s", (name,))
        boundary = q.fetchone()["seq"]
        boundary = min(boundary, through) if through is not None else boundary
        clauses = ["experiment=%s", "agent_id=%s", "seq<=%s"]
        args = [name, agent_id, boundary]
        for condition, value in [
            ("source=%s", source or None),
            ("day>=%s", start_day),
            ("day<=%s", end_day),
            ("id<%s", before),
            ("LOCATE(%s,searchable)>0", qtext.strip().lower() or None),
        ]:
            if value is not None:
                clauses.append(condition)
                args.append(value)
        q.execute(
            "SELECT id,payload FROM experiences WHERE "
            + " AND ".join(clauses)
            + " ORDER BY id DESC LIMIT %s",
            [*args, limit + 1],
        )
        rows = q.fetchall()
    return {
        "experiences": [
            dict(json.loads(r["payload"]), cursor=r["id"]) for r in rows[:limit]
        ],
        "hasMore": len(rows) > limit,
        "nextCursor": rows[limit - 1]["id"] if len(rows) > limit else None,
        "through": boundary,
    }


def time_stats(name, agent_id=None, start_day=None, end_day=None):
    with transaction() as q:
        clauses = ["experiment=%s"]
        args = [name]
        for condition, value in [
            ("agent_id=%s", agent_id),
            ("day>=%s", start_day),
            ("day<=%s", end_day),
        ]:
            if value is not None:
                clauses.append(condition)
                args.append(value)
        q.execute(
            "SELECT agent_id AS agentId,day,action,source,basic,minutes,starts,completed,failures FROM action_time WHERE "
            + " AND ".join(clauses)
            + " ORDER BY day,agent_id,action",
            args,
        )
        return {
            "rows": q.fetchall(),
            "unit": "allocated_minutes",
            "storage": "mysql-delta-v1",
        }


def replay(name, seq):
    with transaction() as q:
        q.execute("SELECT seq FROM experiments WHERE name=%s", (name,))
        row = q.fetchone()
        if not row or seq > row["seq"]:
            raise ValueError("Replay beyond committed checkpoint")
        q.execute(
            "SELECT seq,payload FROM snapshots WHERE experiment=%s AND seq<=%s ORDER BY seq DESC LIMIT 1",
            (name, seq),
        )
        snap = q.fetchone()
        if not snap:
            raise ValueError("Initial snapshot missing")
        world = decode(snap["payload"])["world"]
        q.execute(
            "SELECT seq,delta FROM replay_events WHERE experiment=%s AND seq>%s AND seq<=%s ORDER BY seq",
            (name, snap["seq"], seq),
        )
        for r in q.fetchall():
            if r["seq"] != world["seq"] + 1:
                raise ValueError("Replay sequence gap")
            apply(world, decode(r["delta"]))
        if world["seq"] != seq:
            raise ValueError("Replay did not reach requested boundary")
        return {"world": world, "storage": "mysql-delta-v1"}


def export_stream(name):
    # A consistent read transaction fixes the checkpoint and every exported row.
    with transaction() as q:
        q.execute("SELECT checkpoint FROM experiments WHERE name=%s", (name,))
        c = decode(q.fetchone()["checkpoint"])
        heads = [a.get("brain", {}).get("contextHead") for a in c["world"]["agents"]]
        yield '{"format":"agent-world-delta-v1","checkpoint":' + json.dumps(
            c, ensure_ascii=False
        )
        for key, table, column in [
            ("events", "events", "payload"),
            ("deltas", "replay_events", "delta"),
            ("snapshots", "snapshots", "payload"),
        ]:
            yield ',"' + key + '":['
            first = True
            cursor = -1
            while True:
                q.execute(
                    f"SELECT seq,{column} FROM {table} WHERE experiment=%s AND seq>%s AND seq<=%s ORDER BY seq LIMIT 200",
                    (name, cursor, c["world"]["seq"]),
                )
                rows = q.fetchall()
                if not rows:
                    break
                for r in rows:
                    value = (
                        json.loads(r[column])
                        if table == "events"
                        else decode(r[column])
                    )
                    if key == "deltas":
                        value = {"seq": r["seq"], "ops": value}
                    yield ("" if first else ",") + json.dumps(value, ensure_ascii=False)
                    first = False
                    cursor = r["seq"]
            yield "]"
        yield ',"timeStats":'
        q.execute(
            "SELECT agent_id AS agentId,day,action,source,basic,minutes,starts,completed,failures FROM action_time WHERE experiment=%s",
            (name,),
        )
        yield json.dumps(q.fetchall())
        q.execute("SELECT metadata,adapter FROM experiments WHERE name=%s", (name,))
        row = q.fetchone()
        yield (
            ',"metadata":'
            + (row["metadata"] or "{}")
            + ',"adapter":'
            + json.dumps(decode(row["adapter"]))
        )
        for key, table, columns in [
            ("decisions", "decisions", ("id",)),
            ("experiences", "experiences", ("id",)),
            ("usage", "agent_usage", ("agent_id", "day")),
            ("pending", "pending", ("id",)),
        ]:
            yield ',"' + key + '":['
            first = True
            cursor = None
            order = ",".join(columns)
            while True:
                condition = (
                    ""
                    if cursor is None
                    else f" AND ({order}) > ({','.join(['%s'] * len(columns))})"
                )
                q.execute(
                    f"SELECT * FROM {table} WHERE experiment=%s"
                    + condition
                    + f" ORDER BY {order} LIMIT 200",
                    [name, *(cursor or ())],
                )
                rows = q.fetchall()
                if not rows:
                    break
                for row in rows:
                    if table == "experiences":
                        value = json.loads(row["payload"])
                    elif table in ("decisions", "pending"):
                        value = decode(row["payload"])
                        heads.extend(a.get("contextTrace", {}).get("turnId") for a in value.get("attempts", []))
                    else:
                        value = {k: v for k, v in row.items() if k != "experiment"}
                    yield ("" if first else ",") + json.dumps(value, ensure_ascii=False)
                    first = False
                    cursor = tuple(row[k] for k in columns)
            yield "]"
        from .context_repository import export_nodes

        yield ',"contextNodes":['
        first = True
        for node in export_nodes(q, heads):
            yield ("" if first else ",") + json.dumps(node, ensure_ascii=False)
            first = False
        yield "]}"
