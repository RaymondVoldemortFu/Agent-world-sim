import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, nextTask, observe, reflect } from '../src/sim/engine';
import { conflicts, nextBatch } from '../src/sim/scheduler';
import { makeRecord, prepareRecord } from '../src/runtime/model';
import type { Action } from '../src/sim/types';
function world() {
  const w = createWorld({ size: 16, population: 6, days: 5 }, 'parallel-test');
  const positions = [
    [1, 1],
    [8, 1],
    [2, 1],
    [12, 12],
    [8, 2],
    [1, 12],
  ];
  w.agents.forEach((a, i) => {
    [a.x, a.y] = positions[i];
  });
  return w;
}
it('takes only a contiguous independent prefix and respects the move halo', () => {
  const w = world();
  expect(nextBatch(w, 6).map((t) => t.agent.id)).toEqual([1, 2]);
  const [a, b] = w.agents;
  b.x = a.x + 2;
  b.y = a.y;
  expect(conflicts(w, a, b)).toBe(true);
  b.x = a.x + 3;
  expect(conflicts(w, a, b)).toBe(false);
});
it('keeps distant partners with shared mutable proposals ordered', () => {
  const w = world(),
    [a, b] = w.agents;
  w.proposals.push({
    id: 'p',
    from: a.id,
    to: b.id,
    day: 1,
    accepted: true,
    revoked: false,
    completed: false,
    attempts: {},
  });
  expect(conflicts(w, a, b)).toBe(true);
  expect(nextBatch(w, 6)).toHaveLength(1);
});
it('parallel prefetched contexts match serial observations and final state', () => {
  const parallel = world(),
    serial = structuredClone(parallel);
  let batches = 0,
    parallelBatches = 0;
  while (parallel.cursor.phase !== 'complete') {
    const batch = nextBatch(parallel, 6);
    if (!batch.length) {
      endDay(parallel);
      nextTask(serial);
      endDay(serial);
      continue;
    }
    batches++;
    if (batch.length > 1) parallelBatches++;
    const records = batch.map((t) => makeRecord(parallel, t));
    for (const r of records) {
      const p = nextTask(parallel)!,
        s = nextTask(serial)!;
      expect(p.id).toBe(s.id);
      expect(r.context).toEqual(observe(serial, s.agent));
      if (r.kind === 'reflection') {
        const reflection = { summary: '整理亲历', claims: [] };
        reflect(parallel, p.agent.id, reflection, p.id);
        reflect(serial, s.agent.id, reflection, s.id);
      } else {
        const choice = (r.agentId + parallel.tick + parallel.cursor.round) % 5;
        const action: Action =
          choice === 0
            ? { type: 'move', dx: 1, dy: 0 }
            : choice === 1
              ? { type: 'gather', resource: 'food' }
              : choice === 2
                ? { type: 'chat', text: '你好，附近有人吗？' }
                : choice === 3
                  ? { type: 'eat', quantity: 1 }
                  : { type: 'wait' };
        act(parallel, p.agent.id, { intent: '', action }, p.id);
        act(serial, s.agent.id, { intent: '', action }, s.id);
      }
    }
  }
  expect(parallelBatches).toBeGreaterThan(0);
  expect(batches).toBeLessThan(96);
  expect(hashWorld(parallel)).toBe(hashWorld(serial));
});
it('clones prefetched observations and rejects stale cached results', () => {
  const w = world(),
    t = nextBatch(w, 1)[0];
  const saved = makeRecord(w, t);
  saved.status = 'received';
  saved.decision = { intent: '', action: { type: 'wait' } };
  saved.attempts = [{ status: 200, content: 'old', elapsedMs: 1 }];
  w.agents[0].hunger = 20;
  expect((saved.context as any).self.hunger).toBe(100);
  const next = prepareRecord(w, t, saved);
  expect(next.status).toBe('pending');
  expect(next.decision).toBeUndefined();
  expect(next.attempts).toHaveLength(1);
});
