"""Isolated persistence/model gateway for the continuous prototype (port 8002)."""

import asyncio
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, Depends, Query
from pydantic import BaseModel, Field

from . import storage as s
from .storage_api import local, name_check
from .context_engine import persona, tokens, COMPRESS


def initialize():
    with s.transaction() as q:
        q.execute("""CREATE TABLE IF NOT EXISTS continuous_runs (
          id VARCHAR(100) PRIMARY KEY, seq BIGINT NOT NULL, sim_time DOUBLE NOT NULL,
          state LONGBLOB NOT NULL, updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)""")
        q.execute("""CREATE TABLE IF NOT EXISTS continuous_events (
          run_id VARCHAR(100), seq BIGINT, sim_time DOUBLE, actor INT, kind VARCHAR(40),
          payload LONGBLOB, PRIMARY KEY(run_id,seq), KEY time_idx(run_id,sim_time,seq))""")
        q.execute("SHOW INDEX FROM continuous_events WHERE Key_name='dialogue_idx'")
        if not q.fetchone():
            q.execute("CREATE INDEX dialogue_idx ON continuous_events(run_id,kind,seq)")
        q.execute("""CREATE TABLE IF NOT EXISTS continuous_snapshots (
          run_id VARCHAR(100), seq BIGINT, sim_time DOUBLE, payload LONGBLOB,
          PRIMARY KEY(run_id,seq), KEY snap_time(run_id,sim_time))""")
        q.execute("""CREATE TABLE IF NOT EXISTS continuous_contexts (
          run_id VARCHAR(100), actor INT, payload LONGBLOB, PRIMARY KEY(run_id,actor))""")
        q.execute("""CREATE TABLE IF NOT EXISTS continuous_thoughts (
          run_id VARCHAR(100), request_id VARCHAR(150), actor INT, payload LONGBLOB,
          PRIMARY KEY(run_id,request_id))""")


@asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(initialize)
    app.state.client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10))
    app.state.semaphore = asyncio.Semaphore(8)
    app.state.actor_locks = {}
    yield
    await app.state.client.aclose()


app = FastAPI(title="Continuous world gateway", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "configured": bool(os.getenv("DEEPSEEK_API_KEY"))}


@app.get("/runs")
def runs():
    with s.transaction() as q:
        q.execute(
            "SELECT id,seq,sim_time FROM continuous_runs ORDER BY updated DESC LIMIT 50"
        )
        return q.fetchall()


@app.get("/runs/{name}")
def load(name: str):
    name_check(name)
    with s.transaction() as q:
        q.execute("SELECT state FROM continuous_runs WHERE id=%s", (name,))
        row = q.fetchone()
    if not row:
        raise HTTPException(404, "实验不存在")
    return s.decode(row["state"])


@app.post("/runs/{name}", dependencies=[Depends(local)])
def create(name: str, data: dict):
    name_check(name)
    world = data["world"]
    if (
        world["id"] != name
        or world["seq"] != 0
        or world["version"] != "continuous-prototype-1"
    ):
        raise HTTPException(400, "初始状态版本不匹配")
    blob = s.encode(world)
    with s.transaction() as q:
        q.execute("SELECT id FROM continuous_runs WHERE id=%s FOR UPDATE", (name,))
        if q.fetchone():
            raise HTTPException(409, "实验已存在")
        q.execute(
            "INSERT INTO continuous_runs(id,seq,sim_time,state) VALUES(%s,0,0,%s)",
            (name, blob),
        )
        q.execute("INSERT INTO continuous_snapshots VALUES(%s,0,0,%s)", (name, blob))
    return {"ok": True}


@app.post("/runs/{name}/commit", dependencies=[Depends(local)])
def commit(name: str, data: dict):
    name_check(name)
    w, events, expected = data["world"], data["events"], data["expected"]
    if w["id"] != name or w["version"] != "continuous-prototype-1":
        raise HTTPException(400, "状态版本不匹配")
    if [e["seq"] for e in events] != list(range(expected + 1, w["seq"] + 1)):
        raise HTTPException(409, "事件序列不连续")
    with s.transaction() as q:
        q.execute(
            "SELECT seq,sim_time,state FROM continuous_runs WHERE id=%s FOR UPDATE",
            (name,),
        )
        row = q.fetchone()
        if not row:
            raise HTTPException(404, "实验不存在")
        if row["seq"] != expected or w["time"] < row["sim_time"]:
            if row["seq"] == w["seq"] and s.decode(row["state"]) == w:
                return {"seq": w["seq"], "duplicate": True}
            raise HTTPException(409, "写入版本已改变，请重新加载")
        prior = s.decode(row["state"])
        last_time = prior["time"]
        for e in events:
            if not last_time <= e["time"] <= w["time"]:
                raise HTTPException(409, "事件时间顺序无效")
            last_time = e["time"]
            for key in ("agents", "stores", "fields", "gates"):
                changed = {r["id"]: r for r in e["patch"].get(key, [])}
                prior[key] = [changed.get(r["id"], r) for r in prior[key]]
            prior.update(e["patch"]["meta"])
            prior["seq"] = e["seq"]
        prior["time"] = w["time"]
        if prior != w:
            raise HTTPException(409, "存在未记录到事件的状态变更")
        q.executemany(
            "INSERT INTO continuous_events VALUES(%s,%s,%s,%s,%s,%s)",
            [
                (name, e["seq"], e["time"], e.get("actor"), e["type"], s.encode(e))
                for e in events
            ],
        )
        blob = s.encode(w)
        q.execute(
            "UPDATE continuous_runs SET seq=%s,sim_time=%s,state=%s WHERE id=%s",
            (w["seq"], w["time"], blob, name),
        )
        if data.get("snapshot"):
            q.execute(
                "INSERT IGNORE INTO continuous_snapshots VALUES(%s,%s,%s,%s)",
                (name, w["seq"], w["time"], blob),
            )
    return {"seq": w["seq"]}


@app.get("/runs/{name}/events")
def events(
    name: str,
    after: int = 0,
    before: int | None = None,
    actor: int | None = None,
    limit: int = Query(100, ge=1, le=2000),
):
    name_check(name)
    clauses = ["run_id=%s", "seq>%s"]
    args = [name, after]
    if before is not None:
        clauses.append("seq<%s")
        args.append(before)
    if actor is not None:
        clauses.append("actor=%s")
        args.append(actor)
    with s.transaction() as q:
        q.execute(
            "SELECT payload FROM continuous_events WHERE "
            + " AND ".join(clauses)
            + " ORDER BY seq DESC LIMIT %s",
            (*args, limit),
        )
        return [s.decode(r["payload"]) for r in reversed(q.fetchall())]


@app.get("/runs/{name}/dialogue")
def dialogue(
    name: str,
    after: int = Query(0, ge=0),
    through: int | None = Query(None, ge=0),
    limit: int = Query(500, ge=1, le=2000),
):
    """Sparse forward stream; starts recover channels in older speech archives."""
    name_check(name)
    with s.transaction() as q:
        q.execute("SELECT seq FROM continuous_runs WHERE id=%s", (name,))
        head = q.fetchone()
        if not head:
            raise HTTPException(404, "实验不存在")
        through = min(through if through is not None else head["seq"], head["seq"])
        # Bound each channel scan by the page size; unrelated movement is never decoded.
        found = []
        for kind in ("speaking", "speech"):
            q.execute(
                "SELECT seq,payload FROM continuous_events WHERE run_id=%s AND kind=%s AND seq>%s AND seq<=%s ORDER BY seq LIMIT %s",
                (name, kind, after, through, limit + 1),
            )
            found.extend(q.fetchall())
    found.sort(key=lambda r: r["seq"])
    rows = []
    for row in found[:limit]:
        e = s.decode(row["payload"])
        channel = e.get("channel")
        if e["type"] == "speaking":
            agent = next((a for a in e["patch"].get("agents", []) if a["id"] == e.get("actor")), {})
            channel = (agent.get("voice") or {}).get("mode")
        rows.append({"seq": e["seq"], "time": e["time"], "type": e["type"],
                     "actor": e.get("actor"), "channel": channel,
                     "text": e.get("text", "") if e["type"] == "speech" else "",
                     "listeners": e.get("listeners", [])})
    return {"events": rows, "hasMore": len(found) > limit,
            "nextCursor": rows[-1]["seq"] if rows else after, "through": through}


@app.get("/runs/{name}/replay")
def replay(name: str, at: float = Query(ge=0)):
    name_check(name)
    with s.transaction() as q:
        q.execute("SELECT sim_time FROM continuous_runs WHERE id=%s", (name,))
        head = q.fetchone()
        if not head:
            raise HTTPException(404, "实验不存在")
        at = min(at, head["sim_time"])
        q.execute(
            "SELECT seq,payload FROM continuous_snapshots WHERE run_id=%s AND sim_time<=%s ORDER BY sim_time DESC,seq DESC LIMIT 1",
            (name, at),
        )
        snap = q.fetchone()
        world = s.decode(snap["payload"])
        q.execute(
            "SELECT payload FROM continuous_events WHERE run_id=%s AND seq>%s AND sim_time<=%s ORDER BY seq",
            (name, snap["seq"], at),
        )
        for row in q.fetchall():
            e = s.decode(row["payload"])
            for key in ("agents", "stores", "fields", "gates"):
                changed = {r["id"]: r for r in e["patch"].get(key, [])}
                world[key] = [changed.get(r["id"], r) for r in world[key]]
            world.update(e["patch"]["meta"])
            world["seq"] = e["seq"]
        world["time"] = at
        return world


@app.get("/runs/{name}/response")
def saved_response(name: str, request_id: str):
    name_check(name)
    with s.transaction() as q:
        q.execute(
            "SELECT payload FROM continuous_thoughts WHERE run_id=%s AND request_id=%s",
            (name, request_id),
        )
        row = q.fetchone()
        return s.decode(row["payload"]) if row else None


RULES = """你是连续时间村庄中的独立居民。身体、位置与任务在你思考期间继续变化；你的输出是未来计划，不是已经发生的行为。只根据可见状态和带来源的经历判断，别人说的话不等于事实。地面、随身粮食、家庭储藏要严格区分：吃饭只消耗随身粮食；储藏中的粮食需要亲自走到现场领取。每天约需0.7353kg粮食，饱食度归零后持续扣血，随身尽量携带5–10日口粮。状态提供随身粮食，家庭储藏只有靠近后可看到当前存量；看不到不等于空。默认只有自动进食至100，补粮和农活需要你配置。
一天24游戏小时，对应现实120秒。你每次思考间隔数小时，可以设置长久任务，不需要为每一步移动重新计划。task省略保持当前任务，null取消任务；routine省略保持当前自动行为。行动和意图必须有区别，不要重复声称已经领取或交付。角色可步行同时说话。死亡者不能接收话语。
地点和居民身份来自下方已知背景。附近观察不会授予远方全知库存。所有居民都可以设置以下任务：navigate到目标地点；supply到储藏补足随身粮食到amount kg（受负重与库存约束）；deliver把随身amount kg粮食存入储藏；farm到指定田耕作或收割；rest在地点休息；guard在地点驻留。粮食只来自成熟田，每30天结算，40天后减产。农活进度跨动作累积。
请主动设置你的自动日程：eat是否自动吃到满饱食度；fetch是否从自己的家庭粮箱补粮；reserveDays储备1–10天；work是否在自己熟悉田条自动劳动。自动日程可关闭，设置要反映你的真实偏好、关系和承诺。
只输出JSON：{"intent":"下一步意图","task":{"kind":"navigate|supply|farm|deliver|rest|guard","target":"真实地点ID","amount":5},"routine":{"eat":true,"fetch":true,"reserveDays":7,"work":true},"speech":{"mode":"talk|public_speak|shout","text":"可选发言"}}。可省略task/routine/speech，task也可null。公开讲话可被附近12米活人听到；shout为75米，是否听见在实际发言时判定。不能据此推断对方同意。发言最多240字，意图最多400字；文本长度是动作校验，模型请求不设输出截断参数。"""


class Think(BaseModel):
    actor: int = Field(ge=1, le=1000)
    requestId: str = Field(max_length=150)
    person: dict
    atlas: str = Field(max_length=12000)
    observation: str = Field(max_length=30000)
    contextWindow: int = Field(default=100000, ge=4000, le=128000)


@app.post("/runs/{name}/think", dependencies=[Depends(local)])
async def think(name: str, req: Think, request: Request):
    name_check(name)
    key = os.getenv("DEEPSEEK_API_KEY")
    if not key:
        raise HTTPException(503, "模型密钥未配置")
    lock = request.app.state.actor_locks.setdefault((name, req.actor), asyncio.Lock())
    async with lock:

        def read():
            with s.transaction() as q:
                q.execute(
                    "SELECT payload FROM continuous_thoughts WHERE run_id=%s AND request_id=%s",
                    (name, req.requestId),
                )
                cached = q.fetchone()
                q.execute(
                    "SELECT payload FROM continuous_contexts WHERE run_id=%s AND actor=%s",
                    (name, req.actor),
                )
                row = q.fetchone()
                return s.decode(cached["payload"]) if cached else None, s.decode(
                    row["payload"]
                ) if row else None

        cached, context = await asyncio.to_thread(read)
        if cached:
            return cached
        if context is None:
            context = {
                "prefix": [
                    {"role": "system", "content": RULES},
                    {"role": "user", "content": "熟知地图：\n" + req.atlas},
                    {"role": "user", "content": persona({"self": req.person})},
                ],
                "tail": [],
            }
        usage = {}
        started = time.monotonic()

        async def send(messages):
            async with request.app.state.semaphore:
                r = await request.app.state.client.post(
                    os.getenv("BASE_URL", "https://api.deepseek.com").rstrip("/")
                    + "/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={
                        "model": os.getenv("MODEL_NAME", "deepseek-v4-flash"),
                        "messages": messages,
                        "stream": False,
                        "thinking": {"type": "disabled"},
                        "response_format": {"type": "json_object"},
                    },
                )
            if r.status_code != 200:
                raise HTTPException(502, f"模型服务 HTTP {r.status_code}")
            data = r.json()
            choice = data["choices"][0]
            for k, v in data.get("usage", {}).items():
                if isinstance(v, (float, int)):
                    usage[k] = usage.get(k, 0) + v
            if choice.get("finish_reason") not in (None, "stop"):
                raise HTTPException(502, "模型未完整结束输出")
            return choice["message"]["content"]

        try:
            user = {"role": "user", "content": req.observation}
            if context["tail"] and tokens(context["prefix"] + context["tail"] + [user]) > req.contextWindow * 0.85:
                import json

                summary = json.loads(
                    await send(
                        [{"role": "system", "content": COMPRESS}] + context["tail"]
                    )
                )["summary"]
                context["tail"] = [
                    {
                        "role": "user",
                        "content": "近期经历压缩（保留不确定性）：\n" + summary,
                    }
                ]
            if tokens(context["prefix"] + context["tail"] + [user]) >= req.contextWindow:
                raise HTTPException(422, "固定背景与当前观察超过上下文窗口，请增大下次实验的窗口配置")
            content = await send(context["prefix"] + context["tail"] + [user])
            result = {
                "content": content,
                "usage": usage,
                "elapsedMs": round((time.monotonic() - started) * 1000),
            }
            context["tail"] += [user, {"role": "assistant", "content": content}]
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            result = {"error": "模型请求失败或返回内容无法解析", "usage": usage}
        except HTTPException as e:
            result = {"error": str(e.detail), "usage": usage}

        def save():
            with s.transaction() as q:
                q.execute(
                    "INSERT INTO continuous_thoughts VALUES(%s,%s,%s,%s)",
                    (name, req.requestId, req.actor, s.encode(result)),
                )
                q.execute(
                    "INSERT INTO continuous_contexts VALUES(%s,%s,%s) ON DUPLICATE KEY UPDATE payload=VALUES(payload)",
                    (name, req.actor, s.encode(context)),
                )

        await asyncio.to_thread(save)
        return result
