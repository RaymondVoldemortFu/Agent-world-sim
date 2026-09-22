import { expect, it } from 'vitest';
import { createManorWorld } from '../src/continuous/manor/world';
import {
  fiscalReport,
  manorObservation,
  homeStorageObservation,
} from '../src/continuous/manor/observation';
import {
  royalDay,
  settleOperation,
  witness,
  load,
  spawnRoyal,
} from '../src/continuous/manor/rules';
import { ContinuousEngine, route } from '../src/continuous/engine';
import { DAY, RATION, applyEvent } from '../src/continuous/types';
const world = () => createManorWorld('manor-test', 'llm');
it('rejects automatic supplies from a messenger exit before mutating the plan', () => {
  const w = world();
  spawnRoyal(w, 'messenger', 1);
  const a = w.agents.at(-1)!;
  const engine = new ContinuousEngine(w),
    before = structuredClone(a);
  expect(() =>
    engine.setPlan(a.id, {
      intent: '回家补粮',
      routine: { eat: true, fetch: true, reserveDays: 7, work: false },
    }),
  ).toThrow('没有默认家庭粮仓');
  expect(a).toEqual(before);
  expect(homeStorageObservation(w, a)).toContain('家庭储藏=无');
  expect(manorObservation(w, a)).toContain('补粮仓=未配置有效储藏');
  expect(() =>
    engine.setPlan(a.id, {
      intent: '与居民协商后从真实仓取粮',
      routine: { eat: true, fetch: true, reserveDays: 7, work: false, supplyStore: 'reeve-chest' },
    }),
  ).not.toThrow();
});
it('a persisted invalid automatic supply cannot crash other agents or corrupt replay', () => {
  const w = world();
  w.manor!.king.arrears = 10;
  spawnRoyal(w, 'messenger', 1);
  const a = w.agents.at(-1)!;
  a.grain = 0;
  a.routine.fetch = true;
  const initial = structuredClone(w),
    engine = new ContinuousEngine(w);
  expect(() => {
    engine.pause(false);
    engine.advance(DAY / 24);
  }).not.toThrow();
  expect(a.blocked?.reason).toContain('不是储藏');
  expect(engine.events.some((e) => e.actor === 1)).toBe(true);
  expect(w.time).toBe(DAY / 24);
  const replay = structuredClone(initial);
  for (const e of engine.events) applyEvent(replay, e);
  replay.time = w.time;
  expect(replay).toEqual(w);
});
it('ports family map and physical endowments, with a separate royal warehouse and fiscal advisor', () => {
  const w = world();
  expect(w.agents).toHaveLength(32);
  expect(w.fields).toHaveLength(48);
  expect(w.agents.filter((a) => a.plots?.length === 2)).toHaveLength(24);
  expect(
    w.agents.every(
      (a) =>
        !('role' in a) &&
        a.routine.eat &&
        !a.routine.fetch &&
        !a.routine.work &&
        load(a) <= a.capacity,
    ),
  ).toBe(true);
  expect(w.sites.filter((s) => s.kind === 'hall').map((s) => s.id)).toEqual(['keep-store']);
  const f = fiscalReport(w);
  expect(f.potentialKg).toBeCloseTo(1800 * RATION);
  expect(f.expectedAtCurrentWorkKg).toBe(0);
  expect(f.keepDays).toBeCloseTo(35);
  expect(f.dependents).toBe(7);
  expect(manorObservation(w, w.agents[0])).not.toContain('财政官专属引擎报表');
  expect(manorObservation(w, w.agents[31])).toContain('财政官专属引擎报表');
});
it('collects taxes only from dedicated physical stock and preserves strict continuous arrears', () => {
  const w = world(),
    tax = w.stores.find((s) => s.id === 'royal-tax-store')!,
    keep = w.stores[0];
  const original = keep.grain;
  tax.grain = 100 * RATION;
  royalDay(w, 34);
  expect(tax.grain).toBeCloseTo(100 * RATION);
  expect(w.manor!.missions).toHaveLength(0);
  royalDay(w, 35);
  expect(tax.grain).toBeCloseTo(0);
  expect(w.manor!.king.arrears).toBeCloseTo(350);
  expect(w.manor!.king.overdueSince).toBe(35);
  expect(w.manor!.missions.filter((m) => m.kind === 'messenger')).toHaveLength(1);
  expect(keep.grain).toBe(original);
  tax.grain = 50 * RATION;
  royalDay(w, 40);
  expect(w.manor!.king.arrears).toBeCloseTo(300);
  expect(w.manor!.king.overdueSince).toBe(35);
  royalDay(w, 49);
  expect(w.manor!.king.phase).toBe('warning');
  royalDay(w, 50);
  expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(10);
  expect(w.agents.every((a) => typeof a.id === 'number')).toBe(true);
  tax.grain = 300 * RATION;
  royalDay(w, 51);
  expect(w.manor!.king.arrears).toBeCloseTo(0);
  expect(w.manor!.king.phase).toBe('expedition');
});
it('fully prepared royal stock prevents arrears and messenger, and excess stays in the warehouse', () => {
  const w = world(),
    s = w.stores.find((s) => s.id === 'royal-tax-store')!;
  s.grain = 500 * RATION;
  royalDay(w, 35);
  expect(s.grain).toBeCloseTo(50 * RATION);
  expect(w.manor!.king.arrears).toBe(0);
  expect(w.manor!.missions).toHaveLength(0);
  expect(w.manor!.treasury).toBeCloseTo(450 * RATION);
});
it('death is evidence only; a live messenger must observe, judge and physically return', () => {
  const w = world();
  w.agents[0].dead = true;
  royalDay(w, 35);
  const a = w.agents.at(-1)!;
  expect(w.manor!.king.rebellion).toBeUndefined();
  Object.assign(a, { x: w.agents[0].x, y: w.agents[0].y });
  expect(witness(w, a)).toBe(true);
  expect(w.manor!.king.rebellion).toBeUndefined();
  const op = {
    kind: 'report_rebellion' as const,
    target: 'exit',
    amount: 1,
    text: '我亲见受封者死亡，调查后判断为叛乱',
  };
  expect(settleOperation(w, a, op).text).toContain('交互距离');
  const exit = w.sites.find((s) => s.id === 'exit')!;
  a.x = exit.x;
  a.y = exit.y;
  settleOperation(w, a, op);
  expect(w.manor!.king.rebellion).toContain('使者');
  expect(a.away).toBe(true);
  royalDay(w, 36);
  expect(w.manor!.king.phase).toBe('expedition');
});
it('physical keys gate access and journals are transferred as whole items with private copies', () => {
  const w = world(),
    lord = w.agents[0],
    farmer = w.agents[7],
    hall = w.sites.find((s) => s.id === 'keep-store')!;
  expect(route(w, farmer, hall)).toBeUndefined();
  expect(
    route(
      w,
      lord,
      w.sites.find((s) => s.id === 'plaza')!,
    ),
  ).not.toBeUndefined();
  w.stores.find((s) => s.id === 'keep-store')!.lock!.locked = true;
  farmer.x = lord.x;
  farmer.y = lord.y;
  expect(settleOperation(w, farmer, { kind: 'take', target: hall.id, amount: 1 }).text).toContain(
    'door_locked',
  );
  settleOperation(w, lord, {
    kind: 'give',
    target: `agent:${farmer.id}`,
    amount: 0.05,
    item: 'key_keep',
  });
  expect(farmer.keys).toContain('key_keep');
  expect(lord.keys).not.toContain('key_keep');
  settleOperation(w, lord, { kind: 'write', target: 'ledger-1', amount: 1, text: '实收税粮三袋' });
  expect(manorObservation(w, farmer)).not.toContain('实收税粮三袋');
  settleOperation(w, lord, {
    kind: 'show',
    target: `agent:${farmer.id}`,
    item: 'ledger-1',
    amount: 1,
  });
  expect(manorObservation(w, farmer)).toContain('实收税粮三袋');
  settleOperation(w, lord, { kind: 'write', target: 'ledger-1', amount: 1, text: '新增私密账目' });
  expect(manorObservation(w, farmer)).not.toContain('新增私密账目');
});
it('settles asynchronous operations, monthly yield and appended arrivals with exact replay', () => {
  const w = world();
  for (const a of w.agents) {
    a.dead = true;
    a.hp = 0;
  }
  for (const f of w.fields) f.work = f.required;
  const initial = structuredClone(w),
    e = new ContinuousEngine(w);
  w.time = 29 * DAY;
  w.nextDay = 30 * DAY;
  w.nextBody = 30 * DAY;
  e.advance(30 * DAY);
  expect(w.ledger.grown).toBeCloseTo(1800 * RATION);
  for (const f of w.fields) f.work = f.required;
  w.time = 59 * DAY;
  w.nextDay = 60 * DAY;
  w.nextBody = 60 * DAY;
  e.advance(60 * DAY);
  expect(w.ledger.grown).toBeCloseTo(2700 * RATION);
  const replay = structuredClone(initial);
  for (const event of e.events) applyEvent(replay, event);
  expect(replay).toEqual(w);
});
it('farm work navigates through house doorways and explicit routines replenish carried grain', () => {
  const w = world(),
    a = w.agents[7];
  for (const b of w.agents)
    if (b.id !== a.id) {
      b.dead = true;
      b.hp = 0;
    }
  a.grain = 0.1;
  const e = new ContinuousEngine(w);
  e.setPlan(a.id, {
    intent: '先补粮再种田',
    routine: { eat: true, fetch: true, reserveDays: 7, work: true },
  });
  e.advance(DAY / 2);
  expect(a.stats.eatenKg).toBeGreaterThan(0);
  expect(a.stats.workMs).toBeGreaterThan(0);
  expect(a.grain).toBeGreaterThan(RATION);
  expect(a.blocked?.reason ?? '').not.toContain('无法到达');
});

it('invalid routine updates are atomic and physical keys cannot be fractionally transferred', () => {
  const w = world(),
    e = new ContinuousEngine(w),
    a = w.agents[0],
    b = w.agents[6];
  e.setPlan(a.id, { intent: '去广场', task: { kind: 'navigate', target: 'plaza', amount: 1 } });
  const before = structuredClone(w);
  expect(() =>
    e.setPlan(a.id, {
      intent: '无效日程',
      task: null,
      routine: { eat: true, fetch: true, reserveDays: 7, work: false, supplyStore: 'missing' },
    }),
  ).toThrow();
  expect(w).toEqual(before);
  delete a.motion;
  delete a.action;
  b.x = a.x;
  b.y = a.y;
  settleOperation(w, a, { kind: 'give', target: `agent:${b.id}`, amount: 0.01, item: 'key_keep' });
  expect(a.keys).toContain('key_keep');
  expect(b.keys).not.toContain('key_keep');
});

it('shows integer signed tax balances without treating future tax as arrears', () => {
  const w = world(),
    tax = w.stores.find((s) => s.id === 'royal-tax-store')!,
    finance = w.agents[31];
  expect(manorObservation(w, finance)).toContain('王税粮仓余额0kg');
  tax.grain = 20.8;
  expect(manorObservation(w, finance)).toContain('王税粮仓余额20kg');
  w.manor!.king.arrears = 25 / RATION;
  expect(fiscalReport(w).taxBalanceKg).toBeCloseTo(-4.2);
  expect(manorObservation(w, finance)).toContain('王税粮仓余额-5kg');
  tax.grain = 24.9;
  expect(manorObservation(w, finance)).toContain('王税粮仓余额-1kg');
  tax.grain = 25;
  expect(manorObservation(w, finance)).toContain('王税粮仓余额0kg');
  tax.reserved = 2;
  expect(manorObservation(w, finance)).toContain('王税粮仓余额-2kg');
  expect(tax.grain).toBe(25);
});
