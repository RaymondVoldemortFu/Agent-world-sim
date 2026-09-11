import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { observeEco } from '../src/ecology/engine';
import { ruleDecision, interpret, compactContext, shouldThink } from '../src/brain/controller';
import { MANOR_CONFIG, RATION_KG } from '../src/manor/world';
import {
  executeManor,
  settleManor,
  manorView,
  canEnter,
  observeRoyalMission,
} from '../src/manor/engine';
import { quantity, batch } from '../src/ecology/batches';
import { Tx } from '../src/sim/transaction';
const fixture = () => createWorld({ ...MANOR_CONFIG }, 'manor-test');
describe('manor independent physical world', () => {
  it('seeds 31 biographies, 48 fixed plots, physical equipment and no wild food', () => {
    const w = fixture();
    expect(w.config.size).toBe(24);
    expect(w.agents).toHaveLength(31);
    expect(w.agents.every((a) => !a.role && a.residence?.biography)).toBe(true);
    expect(w.tiles.filter((t) => t.manor?.plot)).toHaveLength(48);
    expect(w.tiles.every((t) => Object.keys(t.eco!.biomass).length === 0)).toBe(true);
    expect(w.agents.slice(7).every((a) => a.residence!.plots.length === 2)).toBe(true);
    expect(w.agents[7].residence!.biography).toContain('家人');
  });
  it('enforces keys independent of identity and hides locked stores', () => {
    const w = fixture(),
      a = w.agents[7];
    a.x = 18;
    a.y = 7;
    expect(canEnter(w, a, 18, 7)).toBe(false);
    expect(
      manorView(w, a)!.nearby.find((t) => t.x === 18 && t.y === 7)!.stores[0].contents,
    ).toBeUndefined();
    expect(() =>
      executeManor(w, new Tx(w), a, { type: 'manor', op: 'withdraw', id: 'keep-store', amount: 1 }),
    ).toThrow('上锁');
    a.eco!.stock.push(batch('key_keep', 0.05, 1, 'stolen-key', 'test'));
    expect(canEnter(w, a, 18, 7)).toBe(true);
    executeManor(w, new Tx(w), a, { type: 'manor', op: 'withdraw', id: 'keep-store', amount: 1 });
    expect(quantity(a.eco!.stock, 'grain')).toBeCloseTo(2 * RATION_KG + 1);
  });
  it('rejects old food collection and does not create food before monthly maturity', () => {
    const w = fixture(),
      a = w.agents[7];
    act(
      w,
      a.id,
      { intent: '找食物', action: { type: 'eco', op: 'collect', item: 'grain' } },
      'wild',
    );
    expect(endDay(w).success).toBe(false);
    const p = w.tiles.find((t) => t.manor?.plot)!.manor!.plot!;
    p.work = p.required;
    w.tick = 29;
    settleManor(w, new Tx(w));
    expect(p.harvest).toBe(0);
    w.tick = 30;
    settleManor(w, new Tx(w));
    expect(p.harvest).toBeCloseTo(p.yieldKg);
    expect(w.manor!.shock).toBe(false);
    p.harvest = 0;
    p.work = p.required;
    w.tick = 40;
    settleManor(w, new Tx(w));
    expect(w.manor!.shock).toBe(true);
    expect(p.harvest).toBe(0);
    w.tick = 60;
    settleManor(w, new Tx(w));
    expect(p.harvest).toBeCloseTo(p.yieldKg * 0.5);
    expect(w.tiles.find((t) => t.manor?.plot?.id === 'plot-2')!.manor!.plot!.harvest).toBe(0);
  });
  it('executes farm promises after speech and allows an explicit strike', () => {
    const w = fixture(),
      a = w.agents[7],
      t = w.tiles.find((t) => t.manor?.plot?.id === 'plot-1')!;
    a.x = t.x;
    a.y = t.y;
    a.eco!.foodKcal = 6000;
    const d = interpret(observeEco(w, a), {
      intent: '去田里干活',
      goal: { skill: 'estate', op: 'work', id: 'plot-1', expires: 20 },
    });
    expect(d.action).toMatchObject({ type: 'manor', op: 'work' });
    const idle = interpret(observeEco(w, a), {
      intent: '停工抗议',
      goal: { skill: 'estate', op: 'rest', expires: 20 },
    });
    a.brain = idle.brainUpdate!.brain;
    expect(ruleDecision(observeEco(w, a)).action).toMatchObject({ type: 'manor', op: 'rest' });
  });
  it('preserves a craft goal while collecting its actual inputs', () => {
    const w = fixture(),
      a = w.agents[7];
    a.x = 12;
    a.y = 12;
    a.eco!.foodKcal = 6000;
    a.brain!.goal = { skill: 'estate', op: 'craft', recipe: 'iron_spear', expires: 10 };
    for (let i = 0; i < 3; i++) {
      const d = ruleDecision(observeEco(w, a));
      act(w, a.id, d, 'craft-' + i);
      expect(endDay(w).success).toBe(true);
    }
    expect(quantity(a.eco!.stock, 'iron_spear')).toBe(1.8);
    expect(a.brain!.goal).toBeUndefined();
  });
  it('records actual gifts and replay without automatic tax deductions', () => {
    const w = fixture(),
      a = w.agents[7],
      b = w.agents[6];
    a.x = b.x;
    a.y = b.y;
    const before = structuredClone(w),
      old = quantity(b.eco!.stock, 'grain');
    const events = [
      act(
        w,
        a.id,
        {
          intent: '给村长一份粮',
          action: { type: 'manor', op: 'give', targetId: b.id, amount: RATION_KG },
        },
        'gift',
      ),
      endDay(w),
    ];
    expect(quantity(b.eco!.stock, 'grain') - old).toBeCloseTo(RATION_KG);
    expect(w.manor!.accounts[0].to).toBe(`agent:${b.id}`);
    expect(w.manor!.king.totalReceived).toBe(0);
    events.forEach((e) => applyEvent(before, e));
    expect(hashWorld(before)).toBe(hashWorld(w));
  });
  it('keeps partial delivery goals and reports missing goods', () => {
    const w = fixture(),
      a = w.agents[7];
    a.x = 0;
    a.y = 10;
    a.brain!.goal = { skill: 'estate', op: 'tribute', quantity: 10, expires: 30 };
    executeManor(w, new Tx(w), a, { type: 'manor', op: 'tribute', amount: 1 });
    expect(a.brain!.goal?.quantity).toBe(9);
    expect(w.manor!.king.totalReceived).toBeCloseTo(1 / RATION_KG);
  });
  it('enforces the strict overdue threshold once, and allows payment by anyone', () => {
    const w = fixture();
    w.tick = 35;
    settleManor(w, new Tx(w));
    expect(w.manor!.king.phase).toBe('warning');
    w.tick = 49;
    settleManor(w, new Tx(w));
    expect(w.manor!.king.phase).toBe('warning');
    expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(0);
    w.tick = 50;
    settleManor(w, new Tx(w));
    expect(w.manor!.king.phase).toBe('expedition');
    expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(10);
    const a = w.agents[7];
    a.x = 0;
    a.y = 10;
    a.eco!.stock.push(batch('grain', 450 * RATION_KG, 42, 'tax', 'test'));
    executeManor(w, new Tx(w), a, { type: 'manor', op: 'tribute', amount: 450 * RATION_KG });
    w.tick = 51;
    settleManor(w, new Tx(w));
    expect(w.manor!.king.arrears).toBe(0);
    expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(10);
  });
  it('requires a messenger to see the corpse and return before royal knowledge changes', () => {
    const w = fixture();
    w.tick = 35;
    settleManor(w, new Tx(w));
    const m = w.manor!.missions[0],
      a = w.agents.find((a) => a.id === m.agentId)!;
    w.agents[0].death = { day: 1, cause: '攻击' };
    observeRoyalMission(w, new Tx(w), a);
    expect(m.report).toBeUndefined();
    expect(w.manor!.king.rebellion).toBeUndefined();
    a.x = 18;
    a.y = 7;
    observeRoyalMission(w, new Tx(w), a);
    expect(m.report).toContain('亲见');
    expect(w.manor!.king.rebellion).toBeUndefined();
    executeManor(w, new Tx(w), a, {
      type: 'manor',
      op: 'report_rebellion',
      text: '亲见领主尸体，本人判断领地已叛乱',
    });
    expect(w.manor!.king.rebellion).toBeUndefined();
    a.x = 0;
    a.y = 10;
    m.returning = true;
    w.tick = 36;
    w.manor!.king.received = w.manor!.king.arrears;
    settleManor(w, new Tx(w));
    expect(w.manor!.king.phase).toBe('expedition');
    expect(w.manor!.king.arrears).toBe(0);
    expect(w.manor!.king.rebellion).toBeDefined();
    expect(a.away).toBe(true);
  });
  it('uses shared scene context with personal identity and never sends royal FSM decisions to LLM', () => {
    const w = fixture(),
      a = w.agents[7],
      c = compactContext(observeEco(w, a));
    expect(c.manor).toBeDefined();
    expect(c.self.biography).toContain('农民');
    w.tick = 35;
    settleManor(w, new Tx(w));
    const messenger = w.agents.at(-1)!;
    expect(shouldThink(observeEco(w, messenger))).toBe(true);
    w.tick = 35;
    settleManor(w, new Tx(w));
    w.tick = 50;
    settleManor(w, new Tx(w));
    expect(shouldThink(observeEco(w, w.agents.at(-1)!))).toBe(false);
    expect(c.manor).not.toHaveProperty('king');
    expect(c.manor).not.toHaveProperty('accounts');
  });
});

it('does not bounce back toward an empty household store while going to farm', () => {
  const w = fixture(),
    a = w.agents[7];
  a.brain!.dailyRoutine = {
    mode: 'custom',
    eat: true,
    fetchFood: true,
    farm: true,
    plots: a.residence!.plots,
  };
  const home = w.tiles[a.residence!.home[1] * 24 + a.residence!.home[0]];
  home.eco!.structures[0].contents = [];
  a.eco!.stock = a.eco!.stock.filter((b) => b.item !== 'grain');
  a.eco!.foodKcal = 2000;
  a.x = home.x;
  a.y = home.y;
  const first = ruleDecision(observeEco(w, a));
  expect(first.action.type).toBe('move');
  act(w, a.id, first, 'leave-empty-home');
  endDay(w);
  const second = ruleDecision(observeEco(w, a));
  expect(second.action.type).toBe('move');
  if (second.action.type === 'move')
    expect([a.x + second.action.dx, a.y + second.action.dy]).not.toEqual(a.residence!.home);
});
it('writes a physical public inscription and completes the goal', () => {
  const w = fixture(),
    a = w.agents[7];
  a.x = 9;
  a.y = 10;
  a.eco!.foodKcal = 6000;
  const d = interpret(observeEco(w, a), {
    intent: '召集会议',
    goal: { skill: 'inscribe', text: '明天在广场商议粮税', x: 9, y: 10, expires: 5 },
  });
  expect(d.action).toMatchObject({ type: 'eco', op: 'inscribe' });
  act(w, a.id, d, 'notice');
  const e = endDay(w);
  expect(e.success).toBe(true);
  expect(
    w.tiles[10 * 24 + 9].eco!.structures[0].contents.some(
      (b) => b.inscription?.text === '明天在广场商议粮税',
    ),
  ).toBe(true);
  expect(a.brain!.goal).toBeUndefined();
});

it('equips the lord with a ten-day ration and explains the relocated shared food store', () => {
  const w = fixture(),
    a = w.agents[0];
  expect(quantity(a.eco!.stock, 'grain')).toBeCloseTo(10 * RATION_KG);
  const t = w.tiles.find((t) => t.eco!.structures.some((s) => s.id === 'keep-store'))!;
  expect([t.x, t.y]).toEqual([18, 7]);
  expect(t.manor?.kind).toBe('keep');
  expect(a.residence!.biography).toContain('(18,7)');
  expect(a.residence!.biography).toContain('4.41kg');
  expect(a.residence!.biography).toContain('estate withdraw');
  const small = createWorld({ ...MANOR_CONFIG, inventoryCapacity: 12 }, 'small');
  expect(small.agents[0].eco!.stock.reduce((n, b) => n + b.kg, 0)).toBeLessThanOrEqual(12.000001);
});

it('keeps the lord emergency ration instead of automatically depositing it on the first day', () => {
  const w = fixture(),
    a = w.agents[0];
  a.x = 18;
  a.y = 7;
  a.eco!.foodKcal = 6000;
  const d = ruleDecision(observeEco(w, a));
  expect(d.action.type === 'manor' && d.action.op === 'deposit').toBe(false);
  expect(a.residence!.reserveDays).toBe(10);
});

it('navigates through the manor gate, holds on arrival and clears stale arrival after leaving, with replay', () => {
  const w = fixture(),
    a = w.agents[1];
  a.x = 9;
  a.y = 11;
  a.eco!.foodKcal = 6000;
  a.ap = 100;
  a.brain!.goal = { skill: 'navigate', x: 18, y: 7, expires: 10 };
  const replay = structuredClone(w);
  const events = [];
  let crossedGate = false;
  for (let i = 0; i < 45 && a.brain!.navigation?.status !== 'arrived'; i++) {
    const d = ruleDecision(observeEco(w, a));
    expect(d.action.type).toBe('move');
    events.push(act(w, a.id, d, `manor-nav-${i}`), endDay(w));
    crossedGate ||= a.x === 15 && a.y === 10;
  }
  expect(crossedGate).toBe(true);
  expect([a.x, a.y]).toEqual([18, 7]);
  expect(a.brain!.navigation).toMatchObject({ status: 'arrived', destination: [18, 7], day: 1 });
  for (let i = 0; i < 2; i++) {
    const d = ruleDecision(observeEco(w, a));
    expect(d.action.type).toBe('wait');
    events.push(act(w, a.id, d, `hold-${i}`), endDay(w));
    expect([a.x, a.y]).toEqual([18, 7]);
  }
  const d = interpret(observeEco(w, a), {
    intent: '去广场',
    goal: { skill: 'navigate', x: 9, y: 10, expires: 10 },
  });
  expect(d.action.type).toBe('move');
  events.push(act(w, a.id, d, 'leave'), endDay(w));
  expect(a.brain!.navigation?.status).not.toBe('arrived');
  events.forEach((e) => applyEvent(replay, e));
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('reports a blocked warehouse entrance without a key instead of claiming arrival', () => {
  const w = fixture(),
    a = w.agents[7];
  a.x = 18;
  a.y = 6;
  a.eco!.foodKcal = 6000;
  a.brain!.goal = { skill: 'navigate', x: 18, y: 7, expires: 10 };
  const d = ruleDecision(observeEco(w, a));
  expect(d.action.type).toBe('wait');
  expect(d.brainUpdate!.brain.navigation?.status).toBe('blocked');
  expect(d.brainUpdate!.brain.goal).toBeDefined();
});

it('exposes the effective routine and lets the actor disable, replace and restore it', () => {
  const w = fixture(),
    a = w.agents[7];
  a.x = 9;
  a.y = 10;
  a.eco!.foodKcal = 1000;
  a.brain!.goal = { skill: 'estate', op: 'work', id: 'plot-1', expires: 30 };
  expect(compactContext(observeEco(w, a)).self.dailyRoutine).toMatchObject({
    mode: 'custom',
    eat: true,
    farm: false,
    plots: [],
  });
  const d = interpret(observeEco(w, a), {
    intent: '停止日程',
    clearGoal: true,
    dailyRoutine: { mode: 'off' },
  });
  expect(d.action.type).toBe('wait');
  const replay = structuredClone(w),
    events = [act(w, a.id, d, 'routine-off'), endDay(w)];
  expect(a.brain!.goal).toBeUndefined();
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  const eat = interpret(observeEco(w, a), {
    intent: '只吃粮不劳动',
    dailyRoutine: { mode: 'custom', eat: true },
  });
  expect(eat.action).toMatchObject({ type: 'eco', op: 'eat' });
  events.push(act(w, a.id, eat, 'routine-eat'), endDay(w));
  expect(compactContext(observeEco(w, a)).self.dailyRoutine).toMatchObject({
    farm: false,
    fetchFood: false,
    idleAt: null,
  });
  a.eco!.foodKcal = 6000;
  const custom = interpret(observeEco(w, a), {
    intent: '在附近固定田条劳动',
    dailyRoutine: { mode: 'custom', farm: true, plots: ['plot-1'], idleAt: [9, 10] },
  });
  expect(custom.action.type).toBe('move');
  const restored = interpret(observeEco(w, a), {
    intent: '恢复',
    dailyRoutine: { mode: 'default' },
  });
  expect(restored.brainUpdate!.brain.dailyRoutine?.mode).toBe('default');
  // Replay the persisted changes before the local-only probes above.
  events.forEach((e) => applyEvent(replay, e));
  expect(replay.agents[7].brain!.dailyRoutine).toEqual({ mode: 'custom', eat: true });
});

it('keeps a successful withdrawal receipt visible after the actor leaves', () => {
  const w = fixture(),
    a = w.agents[1];
  a.x = 18;
  a.y = 7;
  executeManor(w, new Tx(w), a, { type: 'manor', op: 'withdraw', id: 'keep-store', amount: 1 });
  a.x = 9;
  a.y = 11;
  expect(compactContext(observeEco(w, a)).self.lastTaskResult).toMatchObject({
    op: 'withdraw',
    amount: 1,
    position: [18, 7],
  });
});

it('shout is audible at five tiles including diagonals but excludes six, dead and away listeners', () => {
  const w = fixture(),
    a = w.agents[0];
  w.agents.forEach((p) => {
    p.x = 23;
    p.y = 23;
  });
  a.x = 9;
  a.y = 10;
  const positions = [
    [14, 10],
    [14, 15],
    [15, 10],
    [10, 10],
    [10, 11],
  ];
  positions.forEach(([x, y], i) => {
    w.agents[i + 1].x = x;
    w.agents[i + 1].y = y;
  });
  w.agents[4].death = { day: 1, cause: 'test' };
  w.agents[5].away = true;
  const replay = structuredClone(w);
  const events = [
    act(w, a.id, { intent: '召集', action: { type: 'shout', text: '广场集合' } }, 'manor-shout'),
    endDay(w),
  ];
  expect(events[1].recipients).toEqual([1, 2, 3]);
  expect(a.ap).toBe(3);
  events.forEach((e) => applyEvent(replay, e));
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('starts with eating only, requests a personal routine and stays put when food runs out', () => {
  const w = fixture(),
    a = w.agents[7];
  a.eco!.foodKcal = 1000;
  a.brain!.goal = { skill: 'estate', op: 'guard', x: a.x, y: a.y, expires: 30 };
  a.brain!.lastThought = w.tick;
  expect(a.brain!.dailyRoutine).toBeUndefined();
  expect(shouldThink(observeEco(w, a))).toBe(true);
  delete a.brain!.goal;
  const d = ruleDecision(observeEco(w, a));
  expect(d.action).toMatchObject({ type: 'eco', op: 'eat' });
  const stock = a.eco!.stock;
  a.eco!.stock = [];
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  a.eco!.stock = stock;
  expect(compactContext(observeEco(w, a)).self.dailyRoutine).toMatchObject({
    mode: 'custom',
    eat: true,
    fetchFood: false,
    farm: false,
    storeSurplus: false,
    idleAt: null,
  });
  const chosen = interpret(observeEco(w, a), {
    intent: '每天先吃随身粮',
    dailyRoutine: { mode: 'custom', eat: true },
  });
  expect(chosen.action).toMatchObject({ type: 'eco', op: 'eat' });
});

it('sends messengers only for outstanding debt and preserves debt age across partial payments and new bills', () => {
  const w = fixture();
  w.agents[0].eco!.foodKcal = 50000;
  for (const day of [1, 11, 21, 31]) {
    w.tick = day;
    settleManor(w, new Tx(w));
    expect(w.manor!.missions).toHaveLength(0);
  }
  w.manor!.settings.graceDays = 20;
  w.tick = 35;
  settleManor(w, new Tx(w));
  expect(w.manor!.missions.filter((m) => m.kind === 'messenger')).toHaveLength(1);
  expect(w.agents.at(-1)!.residence!.biography).toContain('任何领地因素');
  expect(w.manor!.king.overdueSince).toBe(35);
  w.tick = 40;
  w.manor!.king.received = 100;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.arrears).toBe(350);
  expect(w.manor!.king.overdueSince).toBe(35);
  w.tick = 65;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.overdueSince).toBe(35);
  expect(w.manor!.king.arrears).toBe(800);
  w.tick = 75;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.phase).toBe('warning');
  w.tick = 76;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.phase).toBe('expedition');
});

it('keeps fully paid territories free of messengers and clears debt age only on full settlement', () => {
  const w = fixture();
  w.manor!.king.received = 450;
  w.tick = 35;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.arrears).toBe(0);
  expect(w.manor!.missions).toHaveLength(0);
  w.tick = 65;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.overdueSince).toBe(65);
  w.tick = 66;
  w.manor!.king.received = 450;
  settleManor(w, new Tx(w));
  expect(w.manor!.king.overdueSince).toBeUndefined();
  expect(w.manor!.king.phase).toBe('collecting');
  w.tick = 80;
  settleManor(w, new Tx(w));
  expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(0);
});

it.each([0, 4500])('auto-eats exactly to 100 satiety from %s kcal with replay', (initial) => {
  const w = fixture(),
    a = w.agents[7];
  a.eco!.foodKcal = initial;
  a.eco!.stock = [batch('grain', 3, 1, 'food', 'test')];
  const replay = structuredClone(w);
  const d = ruleDecision(observeEco(w, a));
  expect(d.action).toMatchObject({ type: 'eco', op: 'eat', amount: (5000 - initial) / 3400 });
  const events = [act(w, a.id, d, 'eat-full'), endDay(w)];
  expect(a.hunger).toBeCloseTo(100);
  expect(a.eco!.foodKcal).toBeCloseTo(5000);
  expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
  events.forEach((e) => applyEvent(replay, e));
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('auto-eating accounts for batch quality and consumes available grain when insufficient', () => {
  const w = fixture(),
    a = w.agents[7];
  a.eco!.foodKcal = 1000;
  a.eco!.stock = [batch('grain', 1, 1, 'old', 'test'), batch('grain', 2, 2, 'new', 'test')];
  a.eco!.stock[0].quality = 0.5;
  const d = ruleDecision(observeEco(w, a));
  expect(d.action).toMatchObject({ type: 'eco', op: 'eat', amount: 1 + 2300 / 3400 });
  act(w, a.id, d, 'quality');
  endDay(w);
  expect(a.hunger).toBeCloseTo(100);
  a.eco!.foodKcal = 0;
  a.eco!.stock = [batch('grain', 0.2, 1, 'scarce', 'test')];
  const scarce = ruleDecision(observeEco(w, a));
  expect(scarce.action).toMatchObject({ amount: 0.2 });
  act(w, a.id, scarce, 'scarce');
  endDay(w);
  expect(quantity(a.eco!.stock, 'grain')).toBe(0);
  expect(a.hunger).toBeCloseTo(13.6);
});

it('a messenger returning with a corpse observation alone does not report rebellion', () => {
  const w = fixture();
  w.tick = 35;
  settleManor(w, new Tx(w));
  const m = w.manor!.missions.find((m) => m.kind === 'messenger')!,
    a = w.agents.find((a) => a.id === m.agentId)!;
  expect(() =>
    executeManor(w, new Tx(w), a, { type: 'manor', op: 'report_rebellion', text: '猜测叛乱' }),
  ).toThrow('亲见');
  w.agents[0].death = { day: 35, cause: '饥饿' };
  a.x = 18;
  a.y = 7;
  observeRoyalMission(w, new Tx(w), a);
  expect(m.witnessed).toBe(1);
  a.x = 0;
  a.y = 10;
  m.returning = true;
  w.tick = 36;
  w.manor!.king.received = w.manor!.king.arrears;
  settleManor(w, new Tx(w));
  expect(m.finished).toBe(true);
  expect(w.manor!.king.rebellion).toBeUndefined();
  expect(w.manor!.missions.filter((m) => m.kind === 'army')).toHaveLength(0);
});

it('lets a retainer withdraw provisions inside the hall without a navigation step', () => {
  const w = fixture(),
    a = w.agents[1];
  a.x = 18;
  a.y = 7;
  a.eco!.foodKcal = 5000;
  a.brain!.goal = { skill: 'estate', op: 'withdraw', id: 'keep-store', quantity: 3, expires: 5 };
  const before = quantity(a.eco!.stock, 'grain');
  const d = ruleDecision(observeEco(w, a));
  expect(d.action).toMatchObject({ type: 'manor', op: 'withdraw', id: 'keep-store', amount: 3 });
  act(w, a.id, d, 'hall-provisions');
  endDay(w);
  expect(quantity(a.eco!.stock, 'grain')).toBeCloseTo(before + 3);
  expect([a.x, a.y]).toEqual([18, 7]);
  expect(a.brain!.goal).toBeUndefined();
  expect(w.tiles.find((t) => t.x === 20 && t.y === 5)!.eco!.structures).toEqual([]);
});
