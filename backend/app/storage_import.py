"""Bounded-memory delta archive import. Hidden until all replay checks pass."""

import gzip
import json
from pathlib import Path
from uuid import uuid4
import ijson
from . import storage as s
from .replay_delta import apply

TABLES = (
    "events",
    "experiences",
    "action_time",
    "agent_usage",
    "decisions",
    "pending",
    "snapshots",
    "replay_events",
)


def items(path, prefix):
    with path.open("rb") as probe:
        compressed = probe.read(2) == b"\x1f\x8b"
    with gzip.open(path, "rb") if compressed else path.open("rb") as f:
        yield from ijson.items(f, prefix, use_float=True)


def import_archive(path: Path):
    if next(items(path, "format"), None) != "agent-world-delta-v1":
        raise ValueError("Unsupported archive format")
    c = next(items(path, "checkpoint"))
    w = c["world"]
    target = w["seq"]
    if target < 0 or w.get("version") != 1:
        raise ValueError("Invalid checkpoint")
    name = "import-" + uuid4().hex[:16]
    meta = next(items(path, "metadata"), {})
    initial = next(items(path, "snapshots.item"), None)
    if not initial or initial["world"]["seq"] != 0:
        raise ValueError("Initial snapshot missing")
    s.create(name, initial, meta, "importing")
    try:
        world = initial["world"]
        with s.transaction() as q:
            from .context_repository import insert, validate_ancestry

            imported_heads = []
            for node in items(path, "contextNodes.item"):
                if node["runId"] != w["id"]:
                    raise ValueError("Context archive belongs to another world")
                insert(q, node)
                imported_heads.append(node["id"])
            validate_ancestry(q, imported_heads, w["id"])
            for a in w["agents"]:
                head = a.get("brain", {}).get("contextHead")
                if head:
                    q.execute(
                        "SELECT run_id,agent_id,seq FROM context_nodes WHERE id=%s",
                        (head,),
                    )
                    node = q.fetchone()
                    if (
                        not node
                        or node["run_id"] != w["id"]
                        or node["agent_id"] != a["id"]
                        or node["seq"] > target
                    ):
                        raise ValueError("Invalid context head in archive")
            for snap in items(path, "snapshots.item"):
                seq = snap["world"]["seq"]
                if seq == 0:
                    continue
                if not 0 < seq <= target:
                    raise ValueError("Snapshot beyond checkpoint")
                q.execute(
                    "INSERT INTO snapshots VALUES (%s,%s,%s,%s)",
                    (name, seq, snap["world"]["tick"], s.encode(snap)),
                )
            n = 0
            for row in items(path, "deltas.item"):
                if row["seq"] != n + 1:
                    raise ValueError("Delta sequence gap")
                apply(world, row["ops"])
                n += 1
                if world["seq"] != n:
                    raise ValueError("Invalid delta boundary")
                q.execute(
                    "INSERT INTO replay_events VALUES (%s,%s,%s,%s)",
                    (name, n, world["tick"], s.encode(row["ops"])),
                )
                q.execute(
                    "SELECT payload FROM snapshots WHERE experiment=%s AND seq=%s",
                    (name, n),
                )
                snap = q.fetchone()
                if snap and s.decode(snap["payload"])["world"] != world:
                    raise ValueError("Snapshot does not match replay")
            if n != target or world != w:
                raise ValueError("Final checkpoint does not match replay")
            n = 0
            for e in items(path, "events.item"):
                if e["seq"] != n + 1:
                    raise ValueError("Event sequence gap")
                n += 1
                search = " ".join(
                    [
                        e["text"],
                        e["type"],
                        s.EVENT_NAMES.get(e["type"], ""),
                        ",".join(map(str, e.get("position") or [])),
                    ]
                ).lower()
                q.execute(
                    "INSERT INTO events VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        name,
                        n,
                        e["day"],
                        e["type"],
                        e.get("actorId"),
                        e["decisionId"].removesuffix(":complete"),
                        search,
                        json.dumps(e, ensure_ascii=False),
                    ),
                )
            if n != target:
                raise ValueError("Event metadata count mismatch")
            for r in items(path, "decisions.item"):
                q.execute(
                    "INSERT INTO decisions VALUES (%s,%s,%s)",
                    (name, r["id"], s.encode(r)),
                )
            for r in items(path, "pending.item"):
                q.execute(
                    "INSERT INTO pending VALUES (%s,%s,%s)",
                    (name, r["id"], s.encode(r)),
                )
            for r in items(path, "timeStats.item"):
                s.rollup(
                    q,
                    name,
                    r["agentId"],
                    r["day"],
                    r["action"],
                    r["source"],
                    r["basic"],
                    r["minutes"],
                    r["starts"],
                    r["completed"],
                    r["failures"],
                )
            for r in items(path, "usage.item"):
                q.execute(
                    "INSERT INTO agent_usage VALUES (%s,%s,%s,%s,%s,%s)",
                    (
                        name,
                        r["agent_id"],
                        r["day"],
                        r["calls"],
                        r["input_tokens"],
                        r["output_tokens"],
                    ),
                )
            for r in items(path, "experiences.item"):
                q.execute(
                    "INSERT INTO experiences(experiment,agent_id,memory_id,seq,day,source,searchable,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        name,
                        r["agentId"],
                        r["id"],
                        r["seq"],
                        r["day"],
                        r["source"],
                        r["content"].lower(),
                        json.dumps(r, ensure_ascii=False),
                    ),
                )
            adapter = next(items(path, "adapter"), None)
            if adapter is None:
                raise ValueError("Resume adapter missing")
            q.execute(
                "UPDATE experiments SET seq=%s,day=%s,alive=%s,model=%s,complete=%s,checkpoint=%s,adapter=%s,state='ready' WHERE name=%s",
                (
                    target,
                    len(w["metrics"]),
                    sum(not a.get("death") for a in w["agents"]),
                    w["usage"].get("model", ""),
                    w["cursor"]["phase"] == "complete",
                    s.encode(c),
                    s.encode(adapter),
                    name,
                ),
            )
        folder = s.ROOT / "artifacts" / name
        folder.mkdir(parents=True)
        (folder / "storage.json").write_text('{"backend":"mysql","version":1}')
        return {"name": name, "seq": target}
    except BaseException:
        with s.transaction() as q:
            for table in TABLES:
                q.execute(f"DELETE FROM {table} WHERE experiment=%s", (name,))
            q.execute("DELETE FROM experiments WHERE name=%s", (name,))
        raise
