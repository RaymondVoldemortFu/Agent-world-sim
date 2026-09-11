import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { observeEco } from '../src/ecology/engine';
import { ruleDecision } from '../src/brain/controller';
import { MANOR_CONFIG } from '../src/manor/world';
import { settleManor } from '../src/manor/engine';
import { actionConditions } from '../src/manor/execution';
import { batch, quantity } from '../src/ecology/batches';
import { Tx } from '../src/sim/transaction';
const fixture = () => createWorld({ ...MANOR_CONFIG, inventoryCapacity: 50 }, 'execution-test');
it('splits the historical 45kg withdrawal by free capacity, then waits with the remaining goal and replays exactly', () => {
  const w = fixture(),
    a = w.agents[0];
  a.x = 18;
  a.y = 7;
  a.eco!.foodKcal = 5000;
  a.eco!.stock = a.eco!.stock.filter((b) => b.item !== 'grain' && b.item !== 'personal_ledger');
  a.brain!.goal = { skill: 'estate', op: 'withdraw', id: 'keep-store', quantity: 45, expires: 5 };
  const replay = structuredClone(w),
    d = ruleDecision(observeEco(w, a));
  expect(d.action).toMatchObject({ op: 'withdraw', amount: 40.05 });
  const events = [act(w, a.id, d, 'partial'), endDay(w)];
  expect(a.brain!.goal!.quantity).toBeCloseTo(4.95);
  const blocked = ruleDecision(observeEco(w, a));
  expect(blocked.action.type).toBe('wait');
  expect(blocked.brainUpdate!.brain.goalBlocked).toContain('负重');
  events.push(act(w, a.id, blocked, 'full'), endDay(w));
  expect(w.counters.failures).toBe(0);
  events.forEach((e) => applyEvent(replay, e));
  expect(hashWorld(replay)).toBe(hashWorld(w));
});
it('waits for stock and wakes when it is replenished, without discarding the goal', () => {
  const w = fixture(),
    a = w.agents[0];
  a.x = 18;
  a.y = 7;
  a.eco!.foodKcal = 5000;
  a.brain!.goal = { skill: 'estate', op: 'withdraw', id: 'keep-store', quantity: 3, expires: 5 };
  const store = w.tiles.find((t) => t.x === 18 && t.y === 7)!.eco!.structures[0];
  store.contents = [];
  const d = ruleDecision(observeEco(w, a));
  expect(d.action.type).toBe('wait');
  act(w, a.id, d, 'empty');
  endDay(w);
  expect(a.brain!.goal?.quantity).toBe(3);
  store.contents.push(batch('grain', 1, 1, 'supply', 'test'));
  const awake = ruleDecision(observeEco(w, a));
  expect(awake.action).toMatchObject({ op: 'withdraw', amount: 1 });
});
it('caps delivery by receiver capacity and blocks zero quantity or unavailable stores', () => {
  const w = fixture(),
    a = w.agents[0],
    b = w.agents[7];
  a.x = b.x = 9;
  a.y = b.y = 10;
  a.eco!.foodKcal = 5000;
  b.eco!.stock = [batch('grain', 49, 1, 'full', 'test')];
  a.brain!.goal = { skill: 'estate', op: 'give', targetId: b.id, quantity: 3, expires: 5 };
  expect(ruleDecision(observeEco(w, a)).action).toMatchObject({ op: 'give', amount: 1 });
  b.eco!.stock[0].kg = 50;
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  a.brain!.goal.quantity = 0;
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  a.brain!.goal = { skill: 'estate', op: 'deposit', id: 'missing', quantity: 2, expires: 5 };
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
});
it('does not retry an unchanged failed condition across waits or days; changed conditions wake it', () => {
  const w = fixture(),
    a = w.agents[0];
  a.x = 18;
  a.y = 7;
  a.eco!.foodKcal = 5000;
  a.brain!.goal = { skill: 'estate', op: 'withdraw', id: 'keep-store', quantity: 1, expires: 5 };
  const action = ruleDecision(observeEco(w, a)).action;
  a.brain!.executionBlock = {
    signature: actionConditions(observeEco(w, a), action),
    reason: '执行时发生冲突',
  };
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  w.tick = 2;
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  w.tiles
    .find((t) => t.x === 18 && t.y === 7)!
    .eco!.structures[0].contents.push(batch('grain', 1, 2, 'fresh', 'test'));
  expect(ruleDecision(observeEco(w, a)).action).toMatchObject({ op: 'withdraw' });
});
it('does not infer rebellion from lord starvation without a messenger report', () => {
  const w = fixture(),
    lord = w.agents[0];
  lord.hp = 1;
  lord.eco!.foodKcal = 0;
  settleManor(w, new Tx(w));
  expect(lord.death?.cause).toBe('饥饿');
  expect(w.manor!.king.rebellion).toBeUndefined();
  expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(0);
  w.tick = 2;
  settleManor(w, new Tx(w));
  expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(0);
});
it('army pursues distant residents, attacks at contact, breaks doors and receives provisions', () => {
  const w = fixture();
  w.agents[0].death = { day: 1, cause: '饥饿' };
  w.manor!.king.arrears = 1;
  w.manor!.king.overdueSince = 1;
  w.tick = 16;
  settleManor(w, new Tx(w));
  const soldier = w.agents.find(
    (a) => a.id === w.manor!.missions.find((m) => m.kind === 'army')!.agentId,
  )!;
  for (const a of w.agents.slice(1, 31)) a.away = true;
  const target = w.agents[7];
  target.away = false;
  target.x = 18;
  target.y = 7;
  soldier.x = 14;
  soldier.y = 10;
  soldier.eco!.foodKcal = 5000;
  expect(ruleDecision(observeEco(w, soldier)).action).toMatchObject({
    type: 'manor',
    op: 'break_lock',
    id: '15,10',
  });
  const gate = w.tiles.find((t) => t.x === 15 && t.y === 10)!.manor!.lock!;
  gate.locked = false;
  expect(ruleDecision(observeEco(w, soldier)).action).toMatchObject({ type: 'move' });
  soldier.x = target.x;
  soldier.y = target.y;
  expect(ruleDecision(observeEco(w, soldier)).action).toMatchObject({
    type: 'attack',
    targetId: target.id,
  });
  soldier.eco!.stock = [];
  soldier.eco!.foodKcal = 0;
  const hp = soldier.hp;
  w.tick = 2;
  settleManor(w, new Tx(w));
  expect(soldier.hp).toBeGreaterThanOrEqual(hp);
  expect(soldier.hunger).toBe(100);
  target.death = { day: 2, cause: '攻击' };
  expect(ruleDecision(observeEco(w, soldier)).action.type).toBe('wait');
  expect(quantity(soldier.eco!.stock, 'grain')).toBe(0);
  const civilian = observeEco(w, w.agents[8]);
  expect(civilian.manor!.external).toBeUndefined();
});
it('daily food routine wakes on visible same-day replenishment of an empty store', () => {
  const w = fixture(),
    a = w.agents[0];
  a.x = 18;
  a.y = 7;
  a.eco!.foodKcal = 5000;
  a.eco!.stock = a.eco!.stock.filter((b) => b.item !== 'grain');
  a.brain!.dailyRoutine = { mode: 'custom', eat: true, fetchFood: true, storeId: 'keep-store' };
  const store = w.tiles.find((t) => t.x === 18 && t.y === 7)!.eco!.structures[0];
  store.contents = [];
  const first = ruleDecision(observeEco(w, a));
  a.brain = first.brainUpdate!.brain;
  expect(first.action.type).toBe('wait');
  expect(a.brain!.estateEmptyStoreDay).toBe(w.tick);
  store.contents.push(batch('grain', 1, 1, 'new', 'test'));
  expect(ruleDecision(observeEco(w, a)).action).toMatchObject({ op: 'withdraw', amount: 1 });
});
