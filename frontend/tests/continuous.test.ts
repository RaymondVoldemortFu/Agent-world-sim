import { describe, expect, it } from 'vitest';
import { ContinuousEngine, route } from '../src/continuous/engine';
import { createContinuousWorld } from '../src/continuous/world';
import {
  DAY,
  DAY_WALL_MS,
  SPEED,
  RATION,
  applyEvent,
  body,
  position,
  type World,
} from '../src/continuous/types';

function quiet() {
  const w = createContinuousWorld('test');
  for (const a of w.agents) {
    a.routine = { eat: false, fetch: false, work: false, reserveDays: 7 };
    delete a.task;
    a.food = 5000;
  }
  return w;
}
const mass = (w: World) =>
  w.agents.reduce((n, a) => n + a.grain, 0) +
  w.stores.reduce((n, s) => n + s.grain, 0) +
  w.fields.reduce((n, f) => n + f.harvest, 0);

describe('continuous simulation', () => {
  it('maps exactly two wall minutes to one game day', () => {
    expect(SPEED).toBe(720);
    expect(DAY_WALL_MS * SPEED).toBe(DAY);
    const e = new ContinuousEngine(quiet());
    e.advance(DAY);
    expect(e.world.time).toBe(DAY);
    expect(e.events.filter((e) => e.type === 'day_end')).toHaveLength(1);
  });
  it('moves along a path continuously and stops at the interpolated position', () => {
    const e = new ContinuousEngine(quiet()),
      a = e.world.agents[0],
      origin = { x: a.x, y: a.y };
    e.setPlan(a.id, { intent: '去大厅', task: { kind: 'navigate', target: 'hall', amount: 1 } });
    const end = a.motion!.end;
    e.advance(end / 2);
    const midpoint = position(a, e.world.time);
    expect(midpoint).not.toEqual(origin);
    expect(midpoint).not.toEqual(e.world.sites[0]);
    e.setPlan(a.id, { intent: '停下', task: null });
    expect({ x: a.x, y: a.y }).toEqual(midpoint);
    expect(a.motion).toBeUndefined();
    e.advance(end);
    expect(position(a, e.world.time)).toEqual(midpoint);
  });
  it('a gate blocks residents without a key, and waking retries on gate changes', () => {
    const w = quiet(),
      e = new ContinuousEngine(w),
      hall = w.sites.find((s) => s.id === 'hall')!;
    e.gate('gate', false);
    expect(route(w, w.agents[0], hall)).toBeUndefined();
    expect(route(w, w.agents[1], hall)).toBeDefined();
    e.setPlan(1, { intent: '进大厅', task: { kind: 'navigate', target: 'hall', amount: 1 } });
    expect(w.agents[0].blocked?.reason).toContain('无法到达');
    e.gate('gate', true);
    e.advance(31 * 60000);
    expect(position(w.agents[0], w.time)).toEqual({ x: hall.x, y: hall.y });
    expect(w.agents[0].task).toBeUndefined();
  });
  it('concurrent withdrawals reserve finite stock and cancellation releases it', () => {
    const w = quiet(),
      s = w.stores[1];
    s.grain = 10;
    for (const a of w.agents.slice(0, 2)) {
      a.x = s.x;
      a.y = s.y;
      a.grain = 0;
    }
    const e = new ContinuousEngine(w),
      before = mass(w);
    for (const a of w.agents.slice(0, 2))
      e.setPlan(a.id, { intent: '取粮', task: { kind: 'supply', target: s.id, amount: 8 } });
    expect(s.reserved).toBe(10);
    expect(w.agents[0].action?.amount).toBe(8);
    expect(w.agents[1].action?.amount).toBe(2);
    e.setPlan(1, { intent: '取消取粮', task: null });
    expect(s.reserved).toBe(2);
    e.advance(31000);
    expect(s.grain).toBe(8);
    expect(w.agents[1].grain).toBe(2);
    // Once the first reservation was released, the second agent can finish its remaining target.
    e.advance(200000);
    expect(s.grain).toBe(2);
    expect(w.agents[1].grain).toBe(8);
    expect(s.reserved).toBe(0);
    expect(mass(w)).toBeCloseTo(before, 9);
  });
  it('interrupted work retains only completed labor across midnight', () => {
    const w = quiet(),
      a = w.agents[0],
      f = w.fields[0];
    a.x = f.x;
    a.y = f.y;
    w.time = DAY - 10 * 60000;
    w.nextBody = DAY;
    const e = new ContinuousEngine(w);
    e.setPlan(1, { intent: '种田', task: { kind: 'farm', target: f.id, amount: 1 } });
    e.advance(DAY + 5 * 60000);
    e.setPlan(1, { intent: '先歇歇', task: null });
    expect(f.work).toBe(15 * 60000);
    expect(a.stats.workMs).toBe(15 * 60000);
  });
  it('speech can coexist with walking and targets listeners at emission time', () => {
    const w = quiet(),
      e = new ContinuousEngine(w),
      a = w.agents[0];
    e.setPlan(1, {
      intent: '边走边说',
      task: { kind: 'navigate', target: 'hall', amount: 1 },
      speech: { mode: 'shout', text: '我们一会儿在广场见。' },
    });
    expect(a.motion).toBeDefined();
    expect(a.voice).toBeDefined();
    const expected = w.agents
      .filter(
        (b) =>
          b.id !== a.id &&
          !b.dead &&
          Math.hypot(position(a, a.voice!.end).x - b.x, position(a, a.voice!.end).y - b.y) <= 75,
      )
      .map((b) => b.id);
    e.advance(a.voice!.end);
    expect(e.events.find((e) => e.type === 'speech')?.listeners).toEqual(expected);
  });
  it('stale and duplicate model replies cannot overwrite or reapply plans', () => {
    const e = new ContinuousEngine(quiet()),
      a = e.world.agents[0],
      t = e.thinking(1, 'request-1')!;
    e.setPlan(1, { intent: '新任务', task: { kind: 'navigate', target: 'plaza', amount: 1 } });
    const result = {
      plan: { intent: '过时任务', task: { kind: 'navigate' as const, target: 'hall', amount: 1 } },
    };
    e.thought(1, t.id, t.version, result);
    expect(a.intent).toBe('新任务');
    expect(a.thoughts).toBe(1);
    const seq = e.world.seq;
    e.thought(1, t.id, t.version, result);
    expect(e.world.seq).toBe(seq);
    expect(e.events.some((e) => e.type === 'plan_rejected')).toBe(true);
  });
  it('thinking does not block tasks and pause freezes all game time', () => {
    const e = new ContinuousEngine(quiet()),
      a = e.world.agents[0];
    e.setPlan(1, { intent: '走到广场', task: { kind: 'navigate', target: 'plaza', amount: 1 } });
    e.thinking(1, 'slow');
    e.advance(10000);
    expect(a.thinking).toBeDefined();
    const time = e.world.time;
    e.pause(true);
    e.advance(DAY);
    expect(e.world.time).toBe(time);
    e.pause(false);
    e.advance(100000);
    expect(a.task).toBeUndefined();
  });
  it('food and starvation integrate elapsed time instead of midnight jumps', () => {
    const a = quiet().agents[0];
    a.food = 1250;
    a.hp = 50;
    expect(body(a, DAY)).toEqual({ food: 0, hp: 43.5 });
    expect(body(a, DAY / 4).food).toBe(625);
  });
  it('automatic eating fills satiety using carried grain and preserves total mass', () => {
    const w = quiet(),
      a = w.agents[0];
    a.food = 2000;
    a.routine.eat = true;
    a.grain = 5;
    const before = mass(w),
      e = new ContinuousEngine(w);
    e.advance(5 * 60000);
    expect(body(a, w.time).food).toBeGreaterThan(4980);
    expect(mass(w) + w.ledger.eaten).toBeCloseTo(before, 8);
  });
  it('compact replay and resuming at an intermediate trajectory match live state', () => {
    const initial = createContinuousWorld('replay'),
      e = new ContinuousEngine(structuredClone(initial));
    e.advance(4321000);
    const restored = structuredClone(initial);
    for (const ev of e.events) applyEvent(restored, ev);
    restored.time = e.world.time;
    expect(restored).toEqual(e.world);
    const resumed = new ContinuousEngine(structuredClone(restored));
    e.advance(DAY);
    resumed.advance(DAY);
    expect(resumed.world).toEqual(e.world);
    expect(mass(e.world) + e.world.ledger.eaten).toBeCloseTo(
      e.world.ledger.initial + e.world.ledger.grown,
      7,
    );
  });
  it('step size does not alter action results', () => {
    const a = new ContinuousEngine(createContinuousWorld('deterministic')),
      b = new ContinuousEngine(createContinuousWorld('deterministic'));
    a.advance(DAY * 2);
    for (let t = 731000; t < DAY * 2; t += 731000) b.advance(t);
    b.advance(DAY * 2);
    expect(b.world).toEqual(a.world);
    expect(a.world.agents.every((a) => a.grain >= 0)).toBe(true);
    expect(a.world.stores.every((s) => s.grain >= s.reserved - 0.000001)).toBe(true);
  });
});
