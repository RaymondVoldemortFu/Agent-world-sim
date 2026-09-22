import { expect, it } from 'vitest';
import { createManorWorld } from '../src/continuous/manor/world';
import { ContinuousEngine } from '../src/continuous/engine';
import { DAY, applyEvent } from '../src/continuous/types';

for (const repeatRoutine of [false, true])
  it(`navigation prevents automatic return after arrival (repeated routine=${repeatRoutine})`, () => {
    const w = createManorWorld('navigation-control', 'llm'),
      a = w.agents[2],
      hall = w.sites.find((s) => s.id === 'keep-store')!;
    Object.assign(a, { x: hall.x, y: hall.y });
    a.grain = 5;
    a.routine = {
      eat: true,
      fetch: true,
      work: true,
      reserveDays: 7,
      supplyStore: 'keep-store',
      depositStore: 'keep-store',
      idleAt: 'plaza',
    };
    const initial = structuredClone(w),
      e = new ContinuousEngine(w);
    e.setPlan(3, {
      intent: '到大厅后停留',
      task: { kind: 'navigate', target: 'keep-store', amount: 1 },
      ...(repeatRoutine ? { routine: { ...a.routine } } : {}),
    });
    e.advance(DAY / 4);
    expect(a.x).toBe(hall.x);
    expect(a.y).toBe(hall.y);
    expect(a.routine).toEqual({
      eat: true,
      fetch: false,
      work: false,
      reserveDays: 7,
      supplyStore: 'keep-store',
    });
    expect(
      e.events.some(
        (ev) =>
          ev.actor === 3 && ev.type === 'routine_interrupted' && ev.text.includes('后续显式设置'),
      ),
    ).toBe(true);
    expect(e.events.filter((ev) => ev.actor === 3 && ev.text === 'walk:plaza')).toEqual([]);
    const replay = structuredClone(initial);
    for (const event of e.events) applyEvent(replay, event);
    replay.time = w.time;
    expect(replay).toEqual(w);
    // A later explicit routine update is honored.
    e.setPlan(3, {
      intent: '恢复广场值守',
      routine: { eat: true, fetch: false, work: false, reserveDays: 7, idleAt: 'plaza' },
    });
    e.advance(w.time + DAY / 4);
    expect(a.x).toBe(142.5);
    expect(a.y).toBe(157.5);
  });
it('navigation interrupts automatic withdrawal, releases reservations and preserves eating preference', () => {
  const w = createManorWorld('navigation-withdraw', 'llm'),
    a = w.agents[2],
    hall = w.stores.find((s) => s.id === 'keep-store')!;
  Object.assign(a, { x: hall.x, y: hall.y });
  a.grain = 0;
  a.routine = { eat: false, fetch: true, work: false, reserveDays: 7 };
  const e = new ContinuousEngine(w);
  e.advance(1);
  expect(a.action?.kind).toBe('withdraw');
  expect(hall.reserved).toBeGreaterThan(0);
  e.setPlan(3, {
    intent: '停止补粮去广场',
    task: { kind: 'navigate', target: 'plaza', amount: 1 },
  });
  expect(hall.reserved).toBeCloseTo(0);
  expect(a.routine.eat).toBe(false);
  expect(a.routine.fetch).toBe(false);
  expect(a.action?.kind).toBe('walk');
  expect(a.grain).toBe(0);
});
it('rejected navigation does not disable routines or interrupt the current action', () => {
  const w = createManorWorld('invalid-navigation', 'llm'),
    a = w.agents[2],
    e = new ContinuousEngine(w);
  a.routine = { eat: true, fetch: true, work: true, reserveDays: 7, idleAt: 'plaza' };
  const before = structuredClone(a);
  expect(() =>
    e.setPlan(3, { intent: '错误', task: { kind: 'navigate', target: 'missing', amount: 1 } }),
  ).toThrow();
  expect(a).toEqual(before);
});
