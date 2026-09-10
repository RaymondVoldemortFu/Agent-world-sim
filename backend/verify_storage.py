"""Verify every stored delta and snapshot against the committed checkpoint."""

import hashlib
import json
import sys
from app import storage as s
from app.replay_delta import apply


def verify(name):
    with s.transaction() as q:
        q.execute("SELECT checkpoint FROM experiments WHERE name=%s", (name,))
        c = s.decode(q.fetchone()["checkpoint"])
        q.execute(
            "SELECT seq,payload FROM snapshots WHERE experiment=%s ORDER BY seq",
            (name,),
        )
        snaps = {r["seq"]: r["payload"] for r in q.fetchall()}
        w = s.decode(snaps[0])["world"]
        count = 0
        while count < c["world"]["seq"]:
            q.execute(
                "SELECT seq,delta FROM replay_events WHERE experiment=%s AND seq>%s AND seq<=%s ORDER BY seq LIMIT 200",
                (name, count, c["world"]["seq"]),
            )
            rows = q.fetchall()
            if not rows:
                raise ValueError("Missing replay records")
            for r in rows:
                if r["seq"] != count + 1:
                    raise ValueError("Sequence gap")
                apply(w, s.decode(r["delta"]))
                count += 1
                if w["seq"] != count:
                    raise ValueError("Invalid event sequence")
                if count in snaps and json.dumps(w) != json.dumps(
                    s.decode(snaps[count])["world"]
                ):
                    raise ValueError(f"Snapshot mismatch: {count}")
        if json.dumps(w) != json.dumps(c["world"]):
            raise ValueError("Final world mismatch")
        q.execute(
            "SELECT COUNT(*) n FROM events WHERE experiment=%s AND seq<=%s",
            (name, count),
        )
        if q.fetchone()["n"] != count:
            raise ValueError("Event metadata count mismatch")
    return {
        "experiment": name,
        "ok": True,
        "events": count,
        "snapshots": len(snaps),
        "sha256": hashlib.sha256(
            json.dumps(
                w, sort_keys=True, ensure_ascii=False, separators=(",", ":")
            ).encode()
        ).hexdigest(),
    }


if __name__ == "__main__":
    result = verify(sys.argv[1])
    print(json.dumps(result))
    (s.ROOT / "artifacts" / sys.argv[1] / "verification.json").write_text(
        json.dumps(result, indent=2)
    )
