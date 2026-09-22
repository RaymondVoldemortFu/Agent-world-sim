import { expect, it } from 'vitest';
import { createManorWorld } from '../src/continuous/manor/world';
import {
  carryingCapacity,
  settleOperation,
  spawnRoyal,
  visibleStore,
} from '../src/continuous/manor/rules';
import { mailbox, deliverLetters } from '../src/continuous/manor/letters';
import { navigationFailure } from '../src/continuous/manor/royal-navigation';
import { movementSpeed } from '../src/continuous/game/rules';
import { eventFrame } from '../src/continuous/game/history';
import { ContinuousEngine, route } from '../src/continuous/engine';
import { DAY, PlanSchema, applyEvent, type Task } from '../src/continuous/types';
const world = () => createManorWorld('household-test', 'llm');
it('defines two household appointments, open warehouses and armed physical capabilities', () => {
  const w = world(),
    tax = w.agents[1],
    steward = w.agents[2];
  expect(w.agents).toHaveLength(32);
  expect(tax.name).toBe('税收官罗兰');
  expect(steward.name).toBe('管家雨果');
  expect(tax.keys).toEqual(expect.arrayContaining(['key_keep', 'key_village']));
  expect(tax.items).toMatchObject({ iron_sword: 1.4, mail: 6, wooden_shield: 2.5, horse_cart: 1 });
  for (const id of ['reeve-chest', 'keep-store', 'royal-tax-store'])
    expect(w.stores.find((s) => s.id === id)!.lock!.locked).toBe(false);
  expect(w.sites.find((s) => s.id === 'reeve-chest')!.label).toBe('村庄粮仓');
  expect(w.agents.every((a) => !('role' in a))).toBe(true);
  expect(w.agents[6].biography).not.toContain('由你向各户收粮，再搬运');
  expect(w.agents[0].biography).toContain('自己及随从的口粮');
  expect(w.agents[7].biography).toContain('家人是');
  spawnRoyal(w, 'messenger', 1);
  expect(w.agents.at(-1)!.biography).toContain('不负责帮助领主收税');
});
it('moves bulk grain through all three warehouses, conserving stock with cart capacity and speed', () => {
  const w = world(),
    a = w.agents[1],
    village = w.stores.find((s) => s.id === 'reeve-chest')!,
    keep = w.stores.find((s) => s.id === 'keep-store')!,
    royal = w.stores.find((s) => s.id === 'royal-tax-store')!;
  a.grain = 0;
  village.grain = 800;
  keep.grain = 0;
  royal.grain = 0;
  const normal = movementSpeed(w, a);
  const transfer = (kind: Task['kind'], target: string, n: number) => {
    Object.assign(
      a,
      w.sites.find((s) => s.id === target),
    );
    return settleOperation(w, a, { kind, target, amount: n, item: 'grain' });
  };
  expect(carryingCapacity(a)).toBe(9999);
  transfer('take', 'reeve-chest', 800);
  expect(a.grain).toBe(800);
  expect(movementSpeed(w, a)).toBe(normal);
  transfer('put', 'keep-store', 800);
  expect(keep.grain).toBe(800);
  transfer('take', 'keep-store', 500);
  transfer('tribute', 'royal-tax-store', 500);
  expect([village.grain, keep.grain, royal.grain, a.grain]).toEqual([0, 300, 500, 0]);
  transfer('take', 'keep-store', 200);
  expect(
    settleOperation(w, a, { kind: 'put', target: 'keep-store', amount: 1, item: 'horse_cart' })
      .text,
  ).toContain('先卸下');
  expect(a.items!.horse_cart).toBe(1);
  expect(
    PlanSchema.parse({
      intent: '运粮',
      task: { kind: 'take', target: 'reeve-chest', amount: 9999 },
    }).task!.amount,
  ).toBe(9999);
});
it('delivers private letters one day later and requires explicit steward forwarding', () => {
  const w = world(),
    a = w.agents[7],
    steward = w.agents[2],
    lord = w.agents[0];
  const op: Task = {
    kind: 'write_letter',
    target: 'agent:1',
    amount: 1,
    text: '家中库存只告诉领主',
  };
  expect(settleOperation(w, a, op).text).toContain('已寄出');
  const l = w.manor!.letters![0];
  expect(mailbox(w, lord)).toBe('');
  expect(mailbox(w, steward)).toBe('');
  w.time = DAY - 1;
  expect(deliverLetters(w)).toEqual([]);
  w.time = DAY;
  expect(deliverLetters(w)[0].listeners).toEqual([3]);
  expect(l.status).toBe('held');
  expect(mailbox(w, steward)).toContain(op.text);
  expect(mailbox(w, lord)).toBe('');
  expect(mailbox(w, w.agents[8])).toBe('');
  expect(settleOperation(w, a, { kind: 'forward_letter', target: l.id, amount: 1 }).text).toContain(
    '只能处理',
  );
  settleOperation(w, steward, { kind: 'forward_letter', target: l.id, amount: 1 });
  w.time = 2 * DAY - 1;
  expect(deliverLetters(w)).toEqual([]);
  w.time = 2 * DAY;
  expect(deliverLetters(w)[0].listeners).toEqual([1]);
  expect(l.status).toBe('delivered');
  expect(mailbox(w, lord)).toContain(op.text);
  expect(lord.nextThink).toBeLessThanOrEqual(w.time);
});
it('supports ordinary mail, rejection and dead steward without leaking to the lord', () => {
  const w = world(),
    a = w.agents[7],
    steward = w.agents[2];
  for (const target of ['agent:9', 'agent:1'])
    settleOperation(w, a, { kind: 'write_letter', target, amount: 1, text: '私信' });
  w.time = DAY;
  deliverLetters(w);
  expect(w.manor!.letters![0].status).toBe('delivered');
  const l = w.manor!.letters![1];
  settleOperation(w, steward, { kind: 'reject_letter', target: l.id, amount: 1, text: '扣留原因' });
  expect(l.status).toBe('rejected');
  expect(mailbox(w, w.agents[0])).toBe('');
  settleOperation(w, a, { kind: 'write_letter', target: 'agent:1', amount: 1, text: '新信' });
  steward.dead = true;
  w.time = 2 * DAY;
  deliverLetters(w);
  expect(w.manor!.letters![2].status).toBe('undeliverable');
  expect(mailbox(w, w.agents[0])).toBe('');
});
it('schedules delivery at exact continuous time, survives hydration and replays without losing letters', () => {
  const w = world(),
    a = w.agents[7];
  const initial = structuredClone(w),
    e = new ContinuousEngine(w);
  e.setPlan(a.id, {
    intent: '写信',
    task: { kind: 'write_letter', target: 'agent:9', amount: 1, text: '途中可回放的信' },
  });
  e.advance(DAY / 8);
  const letter = w.manor!.letters![0];
  expect(letter).toBeDefined();
  const restored = structuredClone(w),
    resumed = new ContinuousEngine(restored);
  resumed.advance(letter.dueAt - 1);
  expect(restored.manor!.letters![0].status).toBe('transit');
  resumed.advance(letter.dueAt);
  expect(restored.manor!.letters![0].status).toBe('delivered');
  const replay = structuredClone(initial);
  for (const event of [...e.events, ...resumed.events]) applyEvent(replay, event);
  replay.time = restored.time;
  expect(replay).toEqual(restored);
  let frame = structuredClone(initial);
  for (const event of [...e.events, ...resumed.events]) frame = eventFrame(frame, event);
  frame.time = restored.time;
  expect(frame).toEqual(restored);
  expect(e.events.filter(event => event.patch.mail?.length)).toHaveLength(1);
  expect(e.events.every(event => !event.patch.meta.manor?.letters)).toBe(true);
});
it('classifies invalid coordinates, impassable terrain and the actual blocking door', () => {
  const w = world(),
    a = w.agents[7],
    hall = w.sites.find((s) => s.id === 'keep-store')!;
  expect(navigationFailure(w, a, { x: -1, y: 2 }, 'coord:-1,2')).toContain('coordinate_error');
  expect(navigationFailure(w, a, hall, hall.id)).toContain('door_locked');
  expect(navigationFailure(w, a, hall, hall.id)).toContain('gate');
  const solid = { x: hall.x - 12, y: hall.y };
  expect(route(w, a, solid)).toBeUndefined();
  expect(navigationFailure(w, a, solid, 'wall')).toContain('route_not_found');
  const e = new ContinuousEngine(w);
  expect(() =>
    e.setPlan(a.id, {
      intent: '走出边界',
      task: { kind: 'navigate', target: 'coord:99999,2', amount: 1 },
    }),
  ).toThrow('coordinate_error');
  expect(() =>
    e.setPlan(a.id, {
      intent: '错误地点',
      task: { kind: 'navigate', target: 'missing', amount: 1 },
    }),
  ).toThrow('coordinate_error');
});
it('does not reveal locked house inventory through its wall even with a key', () => {
  const w = world(),
    a = w.agents[7],
    home = w.stores.find((s) => s.id === a.home)!;
  Object.assign(a, { x: home.x + 20, y: home.y });
  expect(visibleStore(w, a, home)).toBe(false);
  Object.assign(a, { x: home.x, y: home.y });
  expect(visibleStore(w, a, home)).toBe(true);
});
it('tax officer physically navigates the collection chain without teleportation', () => {
  const w = world(),
    a = w.agents[1],
    village = w.stores.find((s) => s.id === 'reeve-chest')!,
    keep = w.stores.find((s) => s.id === 'keep-store')!,
    royal = w.stores.find((s) => s.id === 'royal-tax-store')!;
  for (const b of w.agents) if (b.id !== a.id) b.dead = true;
  a.routine.eat = false;
  a.grain = 0;
  village.grain = 800;
  keep.grain = 0;
  royal.grain = 0;
  const initial = structuredClone(w),
    e = new ContinuousEngine(w);
  const stages: Task[] = [
    { kind: 'take', target: 'reeve-chest', amount: 500, item: 'grain' },
    { kind: 'put', target: 'keep-store', amount: 500, item: 'grain' },
    { kind: 'take', target: 'keep-store', amount: 300, item: 'grain' },
    { kind: 'tribute', target: 'royal-tax-store', amount: 300 },
  ];
  for (const task of stages) {
    e.setPlan(a.id, { intent: '执行收税流程', task });
    e.advance(w.time + DAY / 4);
    expect(a.task).toBeUndefined();
    expect(a.blocked).toBeUndefined();
  }
  expect([village.grain, keep.grain, royal.grain, a.grain]).toEqual([300, 200, 300, 0]);
  expect(a.stats.distance).toBeGreaterThan(200);
  const replay = structuredClone(initial);
  for (const event of e.events) applyEvent(replay, event);
  replay.time = w.time;
  expect(replay).toEqual(w);
});
