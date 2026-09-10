"""Stream legacy journals to MySQL; validate every persisted delta before cleanup.
Usage: uv run --project backend python backend/migrate_storage.py [names...] [--cleanup]
"""

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import time
from app import storage as s
from app.replay_delta import event_delta, apply

TABLES = (
    "events",
    "experiences",
    "action_time",
    "agent_usage",
    "decisions",
    "pending",
    "snapshots",
    "replay_events",
    "migrations",
)
SOURCE_FILES = (
    "checkpoint.json",
    "events.jsonl",
    "decisions.jsonl",
    "snapshots.jsonl",
    "summary.json",
    "initial-config.json",
    "implementation.jsonl",
    "pending.json",
    "run.json",
    "run.json.tmp",
    ".chronicle-v1.sqlite3",
    ".chronicle-v1.sqlite3-wal",
    ".chronicle-v1.sqlite3-shm",
)


def lines(path):
    if not path.exists():
        return
    with path.open() as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return {"bytes": path.stat().st_size, "sha256": h.hexdigest()}


def no_writer(folder):
    lock = folder / "runner.lock"
    if lock.exists():
        try:
            os.kill(int(lock.read_text()), 0)
        except ProcessLookupError:
            return
        raise RuntimeError(f"{folder.name}: active writer, pause it before migration")


def legacy_apply(w, e):
    """Independent port of the TypeScript applyEvent contract."""
    if e["seq"] != w["seq"] + 1:
        raise ValueError("Legacy sequence gap")
    p = e["patch"]
    w.update(p["meta"])
    for a in p["agents"]:
        i = next((i for i, v in enumerate(w["agents"]) if v["id"] == a["id"]), None)
        if i is None:
            w["agents"].append(deepcopy(a))
        else:
            w["agents"][i] = deepcopy(a)
    for c in p.get("agentChanges", []):
        a = next(a for a in w["agents"] if a["id"] == c["state"]["id"])
        a.update(deepcopy(c["state"]))
        for key in ("pregnancy", "death"):
            if key not in c["state"]:
                a.pop(key, None)
        for key in ("memories", "inbox", "claims"):
            a[key] = a[key][c[key]["drop"] :] + deepcopy(c[key]["append"])
    for t in p["tiles"]:
        w["tiles"][
            t.get("eco", {}).get("region", 0) * w["config"]["size"] ** 2
            + t["y"] * w["config"]["size"]
            + t["x"]
        ] = t
    w["proposals"] = p["proposals"]
    if "metrics" in p:
        w["metrics"] = p["metrics"]
    return w


def cleanup(folder, manifest):
    no_writer(folder)
    # Check the entire source set before deleting the first file.
    for name, info in manifest["files"].items():
        p = folder / name
        if p.exists() and digest(p) != info:
            raise ValueError(f"Source changed: {p}")
    if not s.exists(folder.name):
        raise ValueError("Destination is not ready")
    with s.transaction() as q:
        q.execute("SELECT verified FROM migrations WHERE experiment=%s", (folder.name,))
        if not q.fetchone()["verified"]:
            raise ValueError("Migration not verified")
    if not s.metadata(folder.name, "deltaOrderVerified"):
        raise ValueError("Run property-order verification before cleanup")
    no_writer(folder)
    removed = 0
    for name, info in manifest["files"].items():
        p = folder / name
        if p.exists():
            p.unlink()
            removed += info["bytes"]
    pending = folder / "pending"
    if pending.exists() and not any(pending.iterdir()):
        pending.rmdir()
    manifest["cleanedBytes"] = sum(
        info["bytes"]
        for name, info in manifest["files"].items()
        if not (folder / name).exists()
    )
    manifest["propertyOrderVerified"] = True
    with s.transaction() as q:
        q.execute(
            "UPDATE migrations SET manifest=%s WHERE experiment=%s",
            (json.dumps(manifest), folder.name),
        )
    (folder / "migration-report.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    return removed


def migrate(folder, clean=False):
    name = folder.name
    no_writer(folder)
    if s.exists(name):
        with s.transaction() as q:
            q.execute(
                "SELECT manifest FROM migrations WHERE experiment=%s AND verified=1",
                (name,),
            )
            row = q.fetchone()
        if clean and row:
            return cleanup(folder, json.loads(row["manifest"]))
        return 0
    files = [folder / f for f in SOURCE_FILES if (folder / f).is_file()]
    files += list((folder / "pending").glob("*.json"))
    manifest = {
        "experiment": name,
        "format": "mysql-delta-v1",
        "files": {str(p.relative_to(folder)): digest(p) for p in files},
    }
    final = json.loads((folder / "checkpoint.json").read_text())
    target = final["world"]["seq"]
    snaps = {
        r["seq"]: r for r in lines(folder / "snapshots.jsonl") if r["seq"] <= target
    }
    if 0 not in snaps:
        raise ValueError(f"{name}: initial snapshot missing")
    reference = deepcopy(snaps[0]["world"])
    converted = deepcopy(reference)
    shadow = deepcopy(reference)
    # Only action/source hints in RAM; full decision contexts are streamed later.
    hints = {
        r["id"]: {
            "decision": {"action": r.get("decision", {}).get("action", {})},
            "source": r.get("source"),
        }
        for r in lines(folder / "decisions.jsonl")
    }
    meta = {
        f: json.loads((folder / f).read_text())
        for f in ("summary.json", "initial-config.json")
        if (folder / f).exists()
    }
    meta["implementation"] = list(lines(folder / "implementation.jsonl"))
    # Retrying an interrupted import only replaces rows still hidden as importing.
    with s.transaction() as q:
        q.execute("SELECT state FROM experiments WHERE name=%s FOR UPDATE", (name,))
        row = q.fetchone()
        if row:
            if row["state"] != "importing":
                raise ValueError("Refusing to replace ready archive")
            for table in TABLES:
                q.execute(f"DELETE FROM {table} WHERE experiment=%s", (name,))
            q.execute("DELETE FROM experiments WHERE name=%s", (name,))
    s.create(name, {"world": snaps[0]["world"], "elapsedMs": 0}, meta, "importing")
    adapter = s.adapter_for(reference)
    kept = set()
    n = 0
    start = time.monotonic()
    db = s.connect()
    try:
        with db.cursor() as q:
            for e in lines(folder / "events.jsonl"):
                if e["seq"] > target:
                    break
                r = hints.get(e["decisionId"])
                if s.ingest_event(q, name, e, adapter, r):
                    kept.add(e["decisionId"])
                ops = event_delta(converted, e)
                legacy_apply(reference, e)
                if converted != reference:
                    raise ValueError(f"Conversion mismatch at {e['seq']}")
                blob = s.encode(ops)
                q.execute(
                    "INSERT INTO replay_events VALUES (%s,%s,%s,%s)",
                    (name, e["seq"], e["day"], blob),
                )
                # Independent replay reads the actual persisted bytes, not shared references.
                q.execute(
                    "SELECT delta FROM replay_events WHERE experiment=%s AND seq=%s",
                    (name, e["seq"]),
                )
                apply(shadow, s.decode(q.fetchone()["delta"]))
                if shadow != reference:
                    raise ValueError(f"Persisted replay mismatch at {e['seq']}")
                if e["seq"] in snaps and json.dumps(shadow) != json.dumps(
                    snaps[e["seq"]]["world"]
                ):
                    raise ValueError(f"Snapshot mismatch at {e['seq']}")
                if e["type"] == "day_end" or e["seq"] in snaps:
                    q.execute(
                        "INSERT INTO snapshots VALUES (%s,%s,%s,%s)",
                        (
                            name,
                            e["seq"],
                            e["day"],
                            s.encode({"world": shadow, "elapsedMs": 0}),
                        ),
                    )
                n += 1
                if n % 200 == 0:
                    db.commit()
            if (
                json.dumps(shadow) != json.dumps(final["world"])
                or reference != final["world"]
            ):
                raise ValueError("Final checkpoint mismatch")
            for r in lines(folder / "decisions.jsonl"):
                q.execute(
                    "SELECT seq FROM events WHERE experiment=%s AND decision_id=%s LIMIT 1",
                    (name, r["id"]),
                )
                if q.fetchone():
                    s.ingest_record(q, name, r, r["id"] in kept)
            for p in list((folder / "pending").glob("*.json")) + (
                [folder / "pending.json"] if (folder / "pending.json").exists() else []
            ):
                r = json.loads(p.read_text())
                q.execute(
                    "SELECT id FROM decisions WHERE experiment=%s AND id=%s",
                    (name, r["id"]),
                )
                if not q.fetchone():
                    q.execute(
                        "INSERT IGNORE INTO pending VALUES (%s,%s,%s)",
                        (name, r["id"], s.encode(r)),
                    )
            w = final["world"]
            q.execute(
                "UPDATE experiments SET seq=%s,day=%s,alive=%s,model=%s,complete=%s,checkpoint=%s,adapter=%s WHERE name=%s",
                (
                    target,
                    len(w["metrics"]),
                    sum(not a.get("death") for a in w["agents"]),
                    w["usage"].get("model", ""),
                    w["cursor"]["phase"] == "complete",
                    s.encode(final),
                    s.encode(adapter),
                    name,
                ),
            )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
    # Replay via the production reader and nearest snapshot, too.
    if s.replay(name, target)["world"] != final["world"]:
        raise ValueError("Production replay mismatch")
    no_writer(folder)
    for filename, info in manifest["files"].items():
        if digest(folder / filename) != info:
            raise ValueError("Source changed while migrating")
    s.set_metadata(name, "deltaOrderVerified", True)
    manifest.update(
        events=n,
        through=target,
        verified=True,
        seconds=round(time.monotonic() - start, 2),
    )
    with s.transaction() as q:
        q.execute("UPDATE experiments SET state='ready' WHERE name=%s", (name,))
        q.execute(
            "INSERT INTO migrations VALUES (%s,1,%s,CURRENT_TIMESTAMP)",
            (name, json.dumps(manifest)),
        )
    (folder / "storage.json").write_text('{"backend":"mysql","version":1}')
    (folder / "migration-report.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    print(json.dumps({k: v for k, v in manifest.items() if k != "files"}), flush=True)
    return cleanup(folder, manifest) if clean else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("names", nargs="*")
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    s.initialize_schema()
    folders = (
        [s.ROOT / "artifacts" / n for n in args.names]
        if args.names
        else sorted(
            (s.ROOT / "artifacts").glob("*/checkpoint.json"),
            key=lambda p: p.stat().st_size,
        )
    )
    total = 0
    for folder in folders:
        if folder.name == "checkpoint.json":
            folder = folder.parent
        total += migrate(folder, args.cleanup)
    print(json.dumps({"cleanedBytes": total}), flush=True)
