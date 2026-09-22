"""Indexed personal experiences derived from committed continuous events."""

from fastapi import APIRouter, Query, HTTPException
from . import storage as s
from .storage_api import name_check

router = APIRouter(prefix="/runs/{name}/experiences")
KINDS = (
    "plan",
    "plan_rejected",
    "think_finished",
    "speech",
    "arrived",
    "withdraw",
    "deposit",
    "work",
    "harvest",
    "death",
    "estate",
    "witness",
    "reaction",
    "gate",
    "routine_interrupted",
    "access_expired",
    "door_noise",
    "royal_return",
    "royal_departure",
)


def initialize(q):
    q.execute(
        """CREATE TABLE IF NOT EXISTS continuous_experiences (
      run_id VARCHAR(100), actor INT, seq BIGINT, sim_time DOUBLE, source VARCHAR(20),
      content TEXT, payload LONGBLOB, PRIMARY KEY(run_id,actor,seq))"""
    )
    q.execute(
        """CREATE TABLE IF NOT EXISTS continuous_experience_progress (
      run_id VARCHAR(100) PRIMARY KEY, seq BIGINT NOT NULL)"""
    )


def index_events(q, name, events):
    rows = []
    for e in events:
        if e["type"] not in KINDS or not e.get("text"):
            continue
        people = set(e.get("listeners") or [])
        if e.get("actor") is not None:
            people.add(e["actor"])
        for actor in people:
            source = (
                "heard"
                if e["type"] in ("speech", "door_noise")
                else (
                    "inferred"
                    if e["type"] in ("plan", "plan_rejected", "think_finished")
                    else "observed"
                )
            )
            data = {k: v for k, v in e.items() if k != "patch"}
            data["source"] = source
            if e["type"] == "plan" and actor == e.get("actor"):
                a = next(
                    (
                        a
                        for a in e.get("patch", {}).get("agents", [])
                        if a["id"] == actor
                    ),
                    {},
                )
                data["plan"] = {
                    k: a[k] for k in ("intent", "task", "routine", "combat") if k in a
                }
            rows.append(
                (name, actor, e["seq"], e["time"], source, e["text"], s.encode(data))
            )
    if rows:
        q.executemany(
            "INSERT IGNORE INTO continuous_experiences VALUES(%s,%s,%s,%s,%s,%s,%s)",
            rows,
        )


def catch_up(name, through):
    # Recheck the watermark under a row lock; concurrent readers index each batch once.
    while True:
        with s.transaction() as q:
            q.execute(
                "INSERT IGNORE INTO continuous_experience_progress VALUES(%s,0)",
                (name,),
            )
            q.execute(
                "SELECT seq FROM continuous_experience_progress WHERE run_id=%s FOR UPDATE",
                (name,),
            )
            start = q.fetchone()["seq"]
            if start >= through:
                return
            q.execute(
                "SELECT payload FROM continuous_events WHERE run_id=%s AND seq>%s AND seq<=%s AND kind IN ("
                + ",".join(["%s"] * len(KINDS))
                + ") ORDER BY seq LIMIT 500",
                (name, start, through, *KINDS),
            )
            events = [s.decode(r["payload"]) for r in q.fetchall()]
            index_events(q, name, events)
            end = events[-1]["seq"] if events else through
            q.execute(
                "UPDATE continuous_experience_progress SET seq=%s WHERE run_id=%s",
                (end, name),
            )


@router.get("")
def listing(
    name: str,
    agent_id: int = Query(ge=1),
    q: str = Query("", max_length=500),
    source: str = Query("", pattern="^(|heard|observed|inferred)$"),
    start_day: int | None = Query(None, ge=1),
    end_day: int | None = Query(None, ge=1),
    before: int | None = Query(None, ge=1),
    through: int = Query(2**63 - 1, ge=0),
    limit: int = Query(60, ge=1, le=100),
):
    name_check(name)
    if start_day and end_day and start_day > end_day:
        raise HTTPException(422, "起始日不能晚于结束日")
    with s.transaction() as cur:
        cur.execute("SELECT seq FROM continuous_runs WHERE id=%s", (name,))
        head = cur.fetchone()
    if not head:
        raise HTTPException(404, "实验不存在")
    through = min(through, head["seq"])
    catch_up(name, through)
    clauses = ["run_id=%s", "actor=%s", "seq<=%s"]
    args = [name, agent_id, through]
    if before:
        clauses.append("seq<%s")
        args.append(before)
    if source:
        clauses.append("source=%s")
        args.append(source)
    if q.strip():
        clauses.append("LOCATE(LOWER(%s),LOWER(content))>0")
        args.append(q.strip())
    if start_day:
        clauses.append("sim_time>=%s")
        args.append((start_day - 1) * 86400000)
    if end_day:
        clauses.append("sim_time<%s")
        args.append(end_day * 86400000)
    with s.transaction() as cur:
        cur.execute(
            "SELECT payload FROM continuous_experiences WHERE "
            + " AND ".join(clauses)
            + " ORDER BY seq DESC LIMIT %s",
            (*args, limit + 1),
        )
        rows = [s.decode(r["payload"]) for r in cur.fetchall()]
    return {
        "rows": rows[:limit],
        "nextCursor": rows[limit - 1]["seq"] if len(rows) > limit else None,
        "through": through,
    }
