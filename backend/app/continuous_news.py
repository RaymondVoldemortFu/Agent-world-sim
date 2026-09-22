"""Continuous-world sources for the shared daily newspaper worker and UI."""

from .continuous_state import merge_meta
import sys
from fastapi import APIRouter, Depends, Query, HTTPException
from . import storage as s, news
from .storage_api import local, name_check

router = APIRouter(prefix="/runs/{name}/news")


def boundaries(name, through=2**63 - 1):
    with s.transaction() as q:
        q.execute(
            "SELECT seq FROM continuous_events WHERE run_id=%s AND kind='day_end' AND seq<=%s ORDER BY seq",
            (name, through),
        )
        return [r["seq"] for r in q.fetchall()]


def day_source(name, day):
    ends = boundaries(name)
    if day < 1 or day > len(ends):
        raise ValueError("该日尚未完成日末结算")
    end, start = ends[day - 1], ends[day - 2] if day > 1 else 0
    with s.transaction() as q:
        q.execute(
            "SELECT seq,payload FROM continuous_snapshots WHERE run_id=%s AND seq<=%s ORDER BY seq DESC LIMIT 1",
            (name, end),
        )
        snap = q.fetchone()
        w = s.decode(snap["payload"])
        q.execute(
            "SELECT payload FROM continuous_events WHERE run_id=%s AND seq>%s AND seq<=%s ORDER BY seq",
            (name, snap["seq"], end),
        )
        for row in q.fetchall():
            e = s.decode(row["payload"])
            for key in ("agents", "stores", "fields", "gates"):
                changed = {r["id"]: r for r in e["patch"].get(key, [])}
                w[key] = [changed.pop(r["id"], r) for r in w[key]] + list(
                    changed.values()
                )
            merge_meta(w, e["patch"])
            w["seq"] = e["seq"]
            w["time"] = e["time"]
        q.execute(
            "SELECT payload FROM continuous_events WHERE run_id=%s AND kind='speech' AND seq>%s AND seq<=%s ORDER BY seq",
            (name, start, end),
        )
        dialogues = [s.decode(r["payload"]) for r in q.fetchall()]
    return w, dialogues, end


def initial_prefix(name):
    with s.transaction() as q:
        q.execute(
            "SELECT payload FROM continuous_snapshots WHERE run_id=%s ORDER BY seq LIMIT 1",
            (name,),
        )
        row = q.fetchone()
    if not row:
        raise ValueError("缺少初始世界快照")
    w = s.decode(row["payload"])
    roster = "；".join(f"#{a['id']} {a['name']}" for a in w["agents"])
    return [
        {"role": "system", "content": news.SYSTEM},
        {
            "role": "user",
            "content": f"连续实验 {name}。每个日末生成一期，HP与饱食度为0–100，粮食单位kg。初始居民：{roster}",
        },
    ]


def day_material(w, dialogues, day):
    counts = {
        "alive": 0,
        "dead": 0,
        "away": 0,
        "critical": 0,
        "dialogues": len(dialogues),
        "stores": len(w["stores"]),
    }
    lines = [f"第{day}天日末快照。", "全体个体：ID 姓名 状态 HP 饱食度 随身粮kg"]
    for a in sorted(w["agents"], key=lambda a: a["id"]):
        elapsed = 0 if a.get("away") else max(0, w["time"] - a["bodyAt"]) / 86400000
        fed = min(elapsed, a["food"] / 2500)
        food = a["food"] if a["dead"] else max(0, a["food"] - elapsed * 2500)
        hp = (
            0
            if a["dead"]
            else max(0, min(100, a["hp"] + fed * 2) - (elapsed - fed) * 15)
        )
        state = "dead" if a["dead"] else "away" if a.get("away") else "alive"
        counts[state] += 1
        if state == "alive" and (hp < 35 or food / 50 < 20):
            counts["critical"] += 1
        lines.append(
            f"#{a['id']} {a['name']} {dict(dead='死亡',away='离境存活',alive='在场存活')[state]} HP={hp:.2f} 饱食度={food/50:.2f} 随身粮={a['grain']:.3f}"
        )
    lines.append("粮仓与家庭储藏（实物kg）：")
    for store in w["stores"]:
        lines.append(
            f"{store['id']} {store['label']} 谷物={store['grain']:.3f} 装取预留={store['reserved']:.3f}"
        )
    speeches = [
        f"E{e['seq']} #{e.get('actor','?')} {e.get('channel','public_speak')} 听众={e.get('listeners',[])}\n{e['text']}"
        for e in dialogues
    ]
    return "\n".join(lines), speeches, counts


def jobs():
    with s.transaction() as q:
        q.execute(
            """SELECT n.experiment,
          (SELECT COALESCE(MAX(d.day),0)+1 FROM daily_news d WHERE d.experiment=n.experiment) next_day,
          (SELECT COUNT(*) FROM continuous_events e WHERE e.run_id=r.id AND e.kind='day_end') completed
          FROM news_streams n JOIN continuous_runs r ON r.id=n.experiment
          WHERE n.enabled=TRUE HAVING next_day<=completed ORDER BY n.experiment"""
        )
        return q.fetchall()


async def worker(app):
    await news.worker(app, source=sys.modules[__name__])


def exists(name):
    name_check(name)
    with s.transaction() as q:
        q.execute("SELECT id FROM continuous_runs WHERE id=%s", (name,))
        if not q.fetchone():
            raise HTTPException(404, "连续实验不存在")


@router.post("", dependencies=[Depends(local)])
def control(name: str, body: news.Control):
    exists(name)
    with s.transaction() as q:
        q.execute(
            """INSERT INTO news_streams(experiment,enabled) VALUES(%s,%s)
          ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),error=NULL,status=IF(status='generating',status,'idle')""",
            (name, body.enabled),
        )
    return {"enabled": body.enabled}


@router.get("")
def listing(
    name: str,
    before: int = Query(1001, ge=1),
    through: int = Query(2**63 - 1, ge=0),
    limit: int = Query(10, ge=1, le=30),
):
    exists(name)
    return news.read_feed(
        name, before, through, limit, completed_days=len(boundaries(name, through))
    )
