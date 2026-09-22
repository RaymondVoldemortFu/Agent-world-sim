import { observation } from './observation';
import http from 'node:http';
import { PendingCommit } from './commit';
import { parseModelPlan, normalizeModelPlan, planError } from './plan';
import { randomUUID } from 'node:crypto';
import { ContinuousEngine } from '../../frontend/src/continuous/engine';
import { createGameWorld } from '../../frontend/src/continuous/game/world';
import { ContinuousConfigSchema, continuousConfig } from '../../frontend/src/continuous/config';
import { DAY, SPEED, type Event, type World } from '../../frontend/src/continuous/types';

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
  retryAt?: number;
  writer: PendingCommit;
  settlements: Array<() => void>;
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
  const recovering = !!s.error && !!s.writer.payload;
  const candidate = s.engine.world;
  if (!s.writer.payload && candidate.time === s.committed.time && candidate.seq === s.expected)
    return;
  const { world, events, snapshot } = await s.writer.save(
    {
      world: candidate,
      events: s.engine.events,
      expected: s.expected,
      snapshot: candidate.time - s.lastSnap >= DAY / 4,
    },
    api,
  );
  s.expected = world.seq;
  s.committed = world;
  s.engine.events.splice(0, events.length);
  if (snapshot) s.lastSnap = world.time;
  if (recovering) {
    s.error = undefined;
    s.lastWall = performance.now();
    for (const peer of s.peers)
      peer.write(`data: ${JSON.stringify({ type: 'snapshot', world })}\n\n`);
  }
  const delta = s.peers.size
    ? `id: ${world.seq}\ndata: ${JSON.stringify({ type: 'delta', events, time: world.time, seq: world.seq })}\n\n`
    : '';
  for (const peer of s.peers) {
    if (peer.writableLength > 2_000_000) {
      peer.end();
      s.peers.delete(peer);
      continue;
    }
    peer.write(delta);
  }
}

async function settle(s: Session) {
  await flush(s);
  while (s.settlements.length) {
    s.settlements.shift()!();
    await flush(s);
  }
}

async function dispatch(s: Session) {
  const w = s.engine.world;
  if (w.mode !== 'llm' || w.status !== 'running') return;
  const admitted: { actor: number; after: number; requestId: string; version: number }[] = [];
  for (const a of [...w.agents].sort((a, b) => a.nextThink - b.nextThink || a.id - b.id)) {
    if (inFlight >= 8 || s.inflight.size >= continuousConfig(w).concurrency) break;
    if (
      a.dead ||
      a.away ||
      w.manor?.missions.some(
        (m) => m.agentId === a.id && (m.kind === 'army' || m.taxPaidAt !== undefined),
      ) ||
      a.nextThink > w.time ||
      a.thinking
    )
      continue;
    const requestId = `${w.id}:${a.id}:${randomUUID()}`,
      after = a.lastRead,
      token = s.engine.thinking(a.id, requestId);
    if (!token) continue;
    inFlight++;
    s.inflight.add(requestId);
    admitted.push({ actor: a.id, after, requestId, version: token.version });
  }
  if (!admitted.length) return;
  try {
    await flush(s);
  } catch (error) {
    for (const t of admitted) {
      inFlight--;
      s.inflight.delete(t.requestId);
      s.settlements.push(() =>
        s.engine.thought(t.actor, t.requestId, t.version, {
          error: '保存规划请求时失败，模型请求尚未发送，稍后重新规划',
        }),
      );
    }
    throw error;
  }
  // Admission is durable. History IO and model latency run outside the world's writer queue.
  const checkpoint = structuredClone(w);
  for (const task of admitted) {
    void (async () => {
      const archive: Event[] = [];
      let before = checkpoint.seq + 1;
      while (true) {
        const page: Event[] = await api(
          `/runs/${w.id}/events?after=${task.after}&before=${before}&limit=2000&compact=true`,
        );
        archive.unshift(...page);
        if (page.length < 2000) break;
        if (page[0].seq >= before) throw Error('上下文历史分页未前进');
        before = page[0].seq;
      }
      return api(`/runs/${w.id}/think`, {
        ...observation(checkpoint, task.actor, archive, task.after),
        requestId: task.requestId,
        contextWindow: continuousConfig(checkpoint).contextWindow,
      });
    })()
      .catch((error) => ({ error: String(error), content: undefined, usage: undefined }))
      .then((result) => {
        s.settlements.push(() => {
          let plan;
          try {
            if (result.content) plan = parseModelPlan(result.content);
          } catch (error) {
            result.error = `模型计划未执行，需修正回复格式：${planError(error)}`;
          }
          s.engine.thought(task.actor, task.requestId, task.version, {
            plan,
            error: result.error,
            tokens: (result.usage?.prompt_tokens ?? 0) + (result.usage?.completion_tokens ?? 0),
          });
        });
        return serial(s, () => settle(s));
      })
      .finally(() => {
        inFlight--;
        s.inflight.delete(task.requestId);
      })
      .catch((error) => {
        s.error = `模型结算保存失败：${String(error)}`;
        for (const peer of s.peers)
          peer.write(`data: ${JSON.stringify({ type: 'error', error: s.error })}\n\n`);
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
    writer: new PendingCommit(),
    settlements: [],
  };
  sessions.set(id, s);
  // A process restart freezes offline time. In-flight provider outcomes are not blindly retried.
  await serial(s, async () => {
    s.engine.refreshMovementSpeed();
    for (const a of w.agents) {
      if (a.thinking) {
        const saved = await api(
          `/runs/${id}/response?request_id=${encodeURIComponent(a.thinking.id)}`,
        );
        let plan;
        try {
          if (saved?.content) plan = parseModelPlan(saved.content);
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
    if (parts[0] === 'internal' && parts[1] === 'validate-plan' && req.method === 'POST') {
      try {
        const data = await read(req);
        if (typeof data.content !== 'string') throw Error('content 必须为文本');
        send(normalizeModelPlan(data.content));
      } catch (error) {
        res.statusCode = 422;
        send({ error: planError(error) });
      }
      return;
    }
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
        const w = createGameWorld(id, data.mode, settings);
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
          writer: new PendingCommit(),
          settlements: [],
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
    if (op === 'experiences' || op === 'news') {
      send(
        await api(
          `/runs/${id}/${op}${url.search}`,
          req.method === 'POST' ? await read(req) : undefined,
        ),
      );
      return;
    }
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
      res.write(
        `data: ${JSON.stringify({ type: 'snapshot', world: s.committed, error: s.error })}\n\n`,
      );
      s.peers.add(res);
      req.on('close', () => s.peers.delete(res));
      return;
    }
    if (req.method === 'POST') {
      const data = await read(req);
      await serial(s, async () => {
        if (s.error) throw Error(s.error);
        await flush(s);
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
        if (s.error && (!s.writer.payload || now < (s.retryAt ?? 0))) return;
        try {
          // Never mutate a world behind an unconfirmed commit.
          await flush(s);
          if (s.error) {
            s.error = undefined;
            s.lastWall = performance.now();
            for (const peer of s.peers)
              peer.write(`data: ${JSON.stringify({ type: 'snapshot', world: s.committed })}\n\n`);
            return;
          }
          await settle(s);
          if (s.engine.world.status === 'running')
            s.engine.advance(s.engine.world.time + Math.min(dt, 1000) * SPEED, 512);
          await flush(s);
          await dispatch(s);
        } catch (e) {
          s.retryAt = performance.now() + 5000;
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
server.listen(Number(process.env.CONTINUOUS_PORT ?? 8001), '127.0.0.1', () =>
  console.log(
    `Continuous world: http://127.0.0.1:${(server.address() as { port: number }).port} — 120 wall seconds/day`,
  ),
);
async function stop() {
  clearInterval(timer);
  for (const s of sessions.values())
    await serial(s, async () => {
      await flush(s);
      s.engine.pause(true);
      await flush(s);
      for (const p of s.peers) p.end();
    });
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
