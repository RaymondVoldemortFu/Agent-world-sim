import { it, expect } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import type { World } from '../src/continuous/types';

it('keeps the world ticking during history IO and asynchronous LLM latency', async () => {
  let world: World | undefined;
  const pending: { res: http.ServerResponse; actor: number }[] = [];
  const gateway = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const data = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url!, 'http://local');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/commit')) {
      world = data.world;
      res.end(JSON.stringify({ seq: world!.seq }));
    } else if (url.pathname.endsWith('/events')) {
      setTimeout(() => res.end('[]'), 450);
    } else if (url.pathname.endsWith('/think')) {
      pending.push({ res, actor: data.actor });
    } else if (req.method === 'POST') {
      world = data.world;
      res.end('{"ok":true}');
    } else res.end(JSON.stringify(world));
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const gatewayPort = (gateway.address() as { port: number }).port;
  const root = path.resolve(import.meta.dirname, '../..');
  const child = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/continuous/server.ts'],
    {
      cwd: root,
      env: {
        ...process.env,
        CONTINUOUS_PORT: '0',
        CONTINUOUS_GATEWAY: `http://127.0.0.1:${gatewayPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.on('data', (d) => {
      const m = String(d).match(/127\.0\.0\.1:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.once('exit', () => reject(Error(stderr)));
  });
  const call = async (p: string, data?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method: data ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    expect(r.ok).toBe(true);
    return r.json();
  };
  let id = '';
  try {
    const normalized = await call('/internal/validate-plan', {
      content: '{"intent":"休息","speech":null}',
    });
    expect(normalized.plan).toEqual({ intent: '休息' });
    expect(normalized.repairs).toContain('speech_null');
    ({ id } = await call('/runs', {
      mode: 'llm',
      config: { scenario: 'elmwick', concurrency: 2, maxCalls: 2 },
    }));
    await expect.poll(() => pending.length, { timeout: 6000 }).toBe(2);
    const before = (await call(`/runs/${id}`)).world.time;
    await expect
      .poll(async () => (await call(`/runs/${id}`)).world.time, { timeout: 3000 })
      .toBeGreaterThan(before + 200000);
    expect((await call(`/runs/${id}`)).inflight).toBe(2);
    await call(`/runs/${id}/plan`, { actor: 1, plan: { intent: '保留新的目标', task: null } });
    for (const { res } of pending)
      res.end(
        JSON.stringify({
          content: JSON.stringify({
            intent: '过期计划',
            task: { kind: 'navigate', target: 'hall', amount: 1 },
          }),
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    await expect.poll(async () => (await call(`/runs/${id}`)).world.agents[0].thoughts).toBe(1);
    const saved = (await call(`/runs/${id}`)).world;
    expect(saved.agents[0].intent).toBe('保留新的目标');
    expect(saved.calls).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await call(`/runs/${id}`)).world.calls).toBeGreaterThan(2);
    expect(saved.version).toBe('continuous-game-2');
    await call(`/runs/${id}/control`, { paused: true });
  } finally {
    for (const { res } of pending) if (!res.writableEnded) res.end('{"error":"test ending"}');
    child.kill('SIGTERM');
    await once(child, 'exit');
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  }
}, 15000);
