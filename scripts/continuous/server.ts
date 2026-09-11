import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { ContinuousEngine } from '../../frontend/src/continuous/engine';
import { createContinuousWorld } from '../../frontend/src/continuous/world';
import { ContinuousConfigSchema, continuousConfig } from '../../frontend/src/continuous/config';
import {
  body,
  position,
  clockLabel,
  DAY,
  SPEED,
  PlanSchema,
  type Event,
  type World,
} from '../../frontend/src/continuous/types';

const gateway = process.env.CONTINUOUS_GATEWAY ?? 'http://127.0.0.1:8002';
async function api(path: string, data?: unknown) {
  const r = await fetch(gateway + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(path.endsWith('/think') ? 180000 : 15000),
  });
  const value = await r.json();
  if (!r.ok) throw Error(value.detail ?? `HTTP ${r.status}`);
  return value;
}
type Session = {
  engine: ContinuousEngine;
  committed: World;
  expected: number;
  lastWall: number;
  lastSnap: number;
  peers: Set<http.ServerResponse>;
  chain: Promise<unknown>;
  error?: string;
  inflight: Set<string>;
};
const sessions = new Map<string, Session>();
const loading = new Map<string, Promise<Session>>();
let inFlight = 0;
const serial = <T>(s: Session, fn: () => Promise<T>): Promise<T> => {
  const result = s.chain.then(fn);
  s.chain = result.catch(() => {});
  return result;
};

async function flush(s: Session) {
  const world = structuredClone(s.engine.world),
    events = s.engine.events.slice();
  const snapshot = world.time - s.lastSnap >= DAY / 4;
  if (world.time === s.committed.time && world.seq === s.expected) return;
  // Retain the exact request on uncertain HTTP completion; commit endpoint is idempotent.
  const payload = { world, events, expected: s.expected, snapshot };
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt++)
    try {
      await api(`/runs/${world.id}/commit`, payload);
      error = undefined;
      break;
    } catch (e) {
      error = e;
    }
  if (error) throw error;
  s.expected = world.seq;
  s.committed = world;
  s.engine.events.splice(0, events.length);
  if (snapshot) s.lastSnap = world.time;
  for (const peer of s.peers) {
    if (peer.writableLength > 2_000_000) {
      peer.end();
      s.peers.delete(peer);
      continue;
    }
    peer.write(
      `id: ${world.seq}\ndata: ${JSON.stringify({ type: 'delta', events, time: world.time, seq: world.seq })}\n\n`,
    );
  }
}

function observation(s: Session, actorId: number, events: Event[], after: number) {
  const w = s.engine.world,
    a = w.agents.find((a) => a.id === actorId)!,
    p = position(a, w.time),
    b = body(a, w.time);
  const near = (v: { x: number; y: number }) => Math.hypot(v.x - p.x, v.y - p.y) <= 30;
  const people = w.agents
    .filter((v) => v.id !== a.id && near(position(v, w.time)))
    .map(
      (v) =>
        `${v.name}#${v.id} ${v.sex} ${v.dead ? '尸体' : '活着'} @${position(v, w.time).x.toFixed(1)},${position(v, w.time).y.toFixed(1)}`,
    );
  const stores = w.stores
    .filter(near)
    .map(
      (v) =>
        `${v.id} 当前谷物${v.grain.toFixed(2)}kg，可领取${(v.grain - v.reserved).toFixed(2)}kg`,
    );
  const heard = events.filter(
    (e) => e.seq > after && (e.actor === a.id || e.listeners?.includes(a.id)) && e.text,
  );
  const text =
    `${clockLabel(w.time)}，观察边界E${w.seq}。你在(${p.x.toFixed(1)},${p.y.toFixed(1)})米，生命${b.hp.toFixed(1)}，饱食度${(b.food / 50).toFixed(1)}，随身口粮${a.grain.toFixed(2)}kg，背包容量${a.capacity}kg。\n` +
    `当前意图：${a.intent}；当前任务：${a.task ? `${a.task.kind} ${a.task.target} ${a.task.amount.toFixed(2)}kg` : '无'}；实际动作：${a.action?.kind ?? '空闲'}。${a.blocked ? `受阻：${a.blocked.reason}` : ''}\n` +
    `当前自动日程：eat=${a.routine.eat}, fetch=${a.routine.fetch}, reserveDays=${a.routine.reserveDays}, work=${a.routine.work}；家庭储藏${a.home}。\n` +
    `可见居民：${people.join('；') || '无'}。现场储藏：${stores.join('；') || '无法看到当前库存，请去粮箱现场查看'}。\n` +
    `附近农田：${w.fields
      .filter(near)
      .map(
        (f) =>
          `${f.id}劳动${Math.round(f.work / 60000)}/${Math.round(f.required / 60000)}分钟，待收谷物${f.harvest.toFixed(2)}kg`,
      )
      .join('；')}\n` +
    `自上次思考后经历：\n${heard.map((e) => `E${e.seq} ${clockLabel(e.time)} #${e.actor ?? '世界'} ${e.type}: ${e.text}`).join('\n') || '无新事件'}`;
  return {
    actor: a.id,
    person: {
      id: a.id,
      name: a.name,
      sex: a.sex,
      personality: a.personality,
      biography: a.biography,
    },
    atlas: w.sites.map((s) => `${s.id}=${s.label} @(${s.x},${s.y})米`).join('\n'),
    observation: text,
  };
}

async function dispatch(s: Session) {
  const w = s.engine.world;
  if (w.mode !== 'llm' || w.status !== 'running' || w.calls >= w.maxCalls) return;
  for (const a of w.agents) {
    if (inFlight >= 8 || s.inflight.size >= continuousConfig(w).concurrency) break;
    if (a.dead || a.nextThink > w.time || a.thinking) continue;
    const requestId = `${w.id}:${a.id}:${randomUUID()}`;
    const after = a.lastRead;
    const token = s.engine.thinking(a.id, requestId);
    if (!token) continue;
    // Fetch all relevant semantic history in pages; never use a rolling snapshot tail.
    const archive: Event[] = [];
    let before: number | undefined;
    do {
      const page: Event[] = await api(
        `/runs/${w.id}/events?after=${after}&limit=2000${before ? `&before=${before}` : ''}`,
      );
      archive.unshift(...page);
      if (page.length < 2000) break;
      before = page[0].seq;
    } while (true);
    archive.push(...s.engine.events);
    const obs = observation(s, a.id, archive, after);
    const initialVersion = a.planVersion;
    await flush(s);
    inFlight++;
    s.inflight.add(requestId);
    void api(`/runs/${w.id}/think`, {
      ...obs,
      requestId,
      contextWindow: continuousConfig(w).contextWindow,
    })
      .then((result) =>
        serial(s, async () => {
          let plan;
          try {
            if (result.content) plan = PlanSchema.parse(JSON.parse(result.content));
          } catch {
            result.error = '模型计划未通过动作校验';
          }
          s.engine.thought(a.id, requestId, initialVersion, {
            plan,
            error: result.error,
            tokens: (result.usage?.prompt_tokens ?? 0) + (result.usage?.completion_tokens ?? 0),
          });
          await flush(s);
        }),
      )
      .catch((error) =>
        serial(s, async () => {
          s.engine.thought(a.id, requestId, initialVersion, { error: String(error) });
          await flush(s);
        }),
      )
      .finally(() => {
        inFlight--;
        s.inflight.delete(requestId);
      });
  }
}

async function load(id: string): Promise<Session> {
  if (loading.has(id)) return loading.get(id)!;
  if (sessions.has(id)) return sessions.get(id)!;
  const pending = hydrate(id);
  loading.set(id, pending);
  try {
    return await pending;
  } finally {
    loading.delete(id);
  }
}
async function hydrate(id: string): Promise<Session> {
  const w: World = await api(`/runs/${id}`);
  const s: Session = {
    engine: new ContinuousEngine(structuredClone(w)),
    committed: w,
    expected: w.seq,
    lastWall: performance.now(),
    lastSnap: w.time,
    peers: new Set(),
    chain: Promise.resolve(),
    inflight: new Set(),
  };
  sessions.set(id, s);
  // A process restart freezes offline time. In-flight provider outcomes are not blindly retried.
  await serial(s, async () => {
    for (const a of w.agents) {
      if (a.thinking) {
        const saved = await api(
          `/runs/${id}/response?request_id=${encodeURIComponent(a.thinking.id)}`,
        );
        let plan;
        try {
          if (saved?.content) plan = PlanSchema.parse(JSON.parse(saved.content));
        } catch {
          /* Reject malformed recovered proposals. */
        }
        s.engine.thought(a.id, a.thinking.id, a.thinking.version, {
          plan,
          tokens: (saved?.usage?.prompt_tokens ?? 0) + (saved?.usage?.completion_tokens ?? 0),
          error:
            saved?.error ?? (plan ? undefined : '执行进程已重启，未取得完整结果，等待下一次规划'),
        });
      }
    }
    s.engine.pause(true);
    await flush(s);
  });
  return s;
}

async function read(req: http.IncomingMessage) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 100000) throw Error('请求过大');
  }
  return text ? JSON.parse(text) : {};
}
const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(origin).hostname)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1'),
      parts = url.pathname
        .replace(/^\/continuous-api/, '')
        .split('/')
        .filter(Boolean);
    const send = (value: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    };
    if (parts[0] === 'health') {
      send({ ok: true, speed: SPEED, daySeconds: 120 });
      return;
    }
    if (parts[0] !== 'runs') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (parts.length === 1) {
      if (req.method === 'POST') {
        const data = await read(req);
        if (!['scripted', 'llm'].includes(data.mode)) throw Error('模式必须为 scripted 或 llm');
        const id = `continuous-${Date.now()}-${randomUUID().slice(0, 6)}`;
        const settings = ContinuousConfigSchema.parse(data.config ?? {});
        const w = createContinuousWorld(id, data.mode, settings.days, settings);
        await api(`/runs/${id}`, { world: w });
        sessions.set(id, {
          engine: new ContinuousEngine(structuredClone(w)),
          committed: w,
          expected: 0,
          lastWall: performance.now(),
          lastSnap: 0,
          peers: new Set(),
          chain: Promise.resolve(),
          inflight: new Set(),
        });
        send({ id });
        return;
      }
      send(await api('/runs'));
      return;
    }
    const id = parts[1];
    if (!/^[\w-]{1,100}$/.test(id)) throw Error('实验 ID 无效');
    const op = parts[2];
    if (op === 'events' || op === 'replay' || op === 'dialogue') {
      send(await api(`/runs/${id}/${op}${url.search}`));
      return;
    }
    const s = await load(id);
    if (op === 'stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', world: s.committed })}\n\n`);
      s.peers.add(res);
      req.on('close', () => s.peers.delete(res));
      return;
    }
    if (req.method === 'POST') {
      const data = await read(req);
      await serial(s, async () => {
        if (s.error) throw Error(s.error);
        if (op === 'control') s.engine.pause(data.paused === true);
        else if (op === 'plan') s.engine.setPlan(data.actor, data.plan);
        else if (op === 'gate') s.engine.gate(data.id, data.open === true);
        else throw Error('未知操作');
        s.lastWall = performance.now();
        await flush(s);
      });
    }
    send({ world: s.committed, error: s.error, inflight: s.inflight.size });
  } catch (e) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(e) }));
  }
});

let ticking = false;
const timer = setInterval(() => {
  if (ticking) return;
  ticking = true;
  void Promise.allSettled(
    [...sessions.values()].map((s) =>
      serial(s, async () => {
        const now = performance.now(),
          dt = now - s.lastWall;
        s.lastWall = now;
        if (s.error) return;
        try {
          if (s.engine.world.status === 'running')
            s.engine.advance(s.engine.world.time + dt * SPEED);
          await flush(s);
          await dispatch(s);
        } catch (e) {
          s.error = `模拟已停止推进：${String(e)}`;
          for (const p of s.peers)
            p.write(`data: ${JSON.stringify({ type: 'error', error: s.error })}\n\n`);
        }
      }),
    ),
  ).finally(() => {
    ticking = false;
  });
}, 100);
server.listen(8001, '127.0.0.1', () =>
  console.log('Continuous world: http://127.0.0.1:8001 — 120 wall seconds/day'),
);
async function stop() {
  clearInterval(timer);
  for (const s of sessions.values())
    await serial(s, async () => {
      s.engine.pause(true);
      await flush(s);
      for (const p of s.peers) p.end();
    });
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
