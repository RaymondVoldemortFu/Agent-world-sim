import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, nextTask, applyEvent } from '../src/sim/engine';
import { nextBatch } from '../src/sim/scheduler';
import { observeEco, metricsEco } from '../src/ecology/engine';
import { ecoAt, climate } from '../src/ecology/world';
import { batch, mass, quantity, energy, take, put, spoil } from '../src/ecology/batches';
import { catalogErrors, ITEMS, RECIPES, BUILDINGS } from '../src/ecology/catalog';
import { finishJobs, settleEcology } from '../src/ecology/environment';
import { Tx } from '../src/sim/transaction';
import { ruleDecision, interpret, compactContext } from '../src/brain/controller';
import { makeRecord, requestDecision, account } from '../src/runtime/model';
import type { World, Action, WorldEvent } from '../src/sim/types';
import { BrainOutputSchema } from '../src/ecology/types';
const world = (extra = {}) =>
  createWorld(
    {
      worldModel: 'ecology',
      population: 2,
      regions: 1,
      days: 10,
      wildlifeEnabled: false,
      ...extra,
    },
    'eco-test',
  );
function runAction(w: World, id: number, action: Action) {
  const a = w.agents.find((a) => a.id === id)!;
  a.ap = 5;
  a.eco!.readyAt = 0;
  const start = act(w, id, { intent: 'test', action }, `${w.id}:test:${w.seq}`);
  const finish = endDay(w);
  return { start, finish };
}
function seed(w: World, id: string, n: number) {
  const t = ecoAt(w, w.agents[0].x, w.agents[0].y).eco!;
  put(t.ground, [batch(id, n, w.tick, `seed-${id}-${w.seq}`, 'test')]);
}
describe('ecology physical engine', () => {
  it('public speaking reaches every nearby living listener once and replays at chat cost', () => {
    const w = world({ population: 6, regions: 2 });
    for (const a of w.agents) {
      a.x = 5;
      a.y = 5;
      a.social!.loneliness = 40;
    }
    w.agents[1].x = 4;
    w.agents[2].y = 6;
    w.agents[3].x = 7;
    w.agents[4].eco!.region = 1;
    w.agents[5].death = { day: 1, cause: '测试' };
    const out = BrainOutputSchema.parse({
      intent: '召集大家讨论',
      speech: { channel: 'public_speak', text: '各位一起商量建粮仓，你们愿意负责什么？' },
    });
    const d = interpret(observeEco(w, w.agents[0]), out);
    expect(d.action.type).toBe('public_speak');
    const replay = structuredClone(w);
    const start = act(w, 1, d, 'public-test');
    expect(w.agents[0].ap).toBeCloseTo(4.8);
    const finish = endDay(w);
    expect(finish.type).toBe('public_speak');
    expect(finish.recipients).toEqual([1, 2, 3]);
    for (const a of w.agents.slice(1, 3)) {
      expect(a.inbox.filter((m) => m.speakerId === 1 && m.source === 'heard')).toHaveLength(1);
      expect(a.social!.loneliness).toBe(40);
    }
    for (const a of w.agents.slice(3)) expect(a.inbox).toHaveLength(0);
    expect(w.agents[0].social!.loneliness).toBe(20);
    expect(w.counters.chats).toBe(1);
    expect(w.proposals).toEqual([]);
    applyEvent(replay, start);
    applyEvent(replay, finish);
    expect(hashWorld(replay)).toBe(hashWorld(w));
    expect(
      BrainOutputSchema.safeParse({ ...out, speech: { ...out.speech, targetId: 2 } }).success,
    ).toBe(false);
  });
  it('public speaking without listeners does not relieve loneliness', () => {
    const w = world({ population: 1 });
    w.agents[0].social!.loneliness = 40;
    runAction(w, 1, { type: 'public_speak', text: '有人吗？' });
    expect(w.agents[0].social!.loneliness).toBe(40);
  });
  it('compact births fill four dry adjacent tiles in one region and preserve seeded replay', () => {
    for (const size of [10, 15, 64]) {
      const config = { spawn: 'compact' as const, size, population: 20, regions: 3, seed: size };
      const w = world(config);
      expect(hashWorld(w)).toBe(hashWorld(world(config)));
      const counts = new Map<string, number>();
      for (const a of w.agents) {
        expect(a.eco!.region).toBe(0);
        expect(ecoAt(w, a.x, a.y).eco!.biome).not.toBe('water');
        expect(observeEco(w, a).people).toHaveLength(19);
        const key = `${a.x},${a.y}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      expect([...counts.values()]).toEqual([5, 5, 5, 5]);
      expect(Math.max(...w.agents.map((a) => a.x)) - Math.min(...w.agents.map((a) => a.x))).toBe(1);
      expect(Math.max(...w.agents.map((a) => a.y)) - Math.min(...w.agents.map((a) => a.y))).toBe(1);
      expect(compactContext(observeEco(w, w.agents[0])).self.role).toBe('prophet');
      expect(compactContext(observeEco(w, w.agents[1])).self.role).toBeUndefined();
    }
  });
  it('catalog conserves mass and food energy, and covers the full industry network', () => {
    expect(catalogErrors()).toEqual([]);
    expect(Object.keys(RECIPES).length).toBeGreaterThan(45);
    expect(Object.keys(BUILDINGS).length).toBeGreaterThan(15);
  });
  it('calendars use exact season boundaries and wrap years', () => {
    expect(climate(59, 1).season).toBe('winter');
    expect(climate(60, 1).season).toBe('spring');
    expect(climate(152, 1).season).toBe('summer');
    expect(climate(244, 1).season).toBe('autumn');
    expect(climate(335, 1).season).toBe('winter');
    expect(climate(366, 1)).toMatchObject({ day: 1, year: 2 });
  });
  it('transfers retain batch risk, origin and date; decay separates energy from illness', () => {
    const a = [batch('grain', 10, 1, 'a', 'test', 1, 0.8)],
      b: typeof a = [];
    put(b, take(a, 'grain', 3));
    expect(mass(a) + mass(b)).toBe(10);
    expect(b[0]).toMatchObject({ created: 1, source: 'test', risk: 0.8 });
    expect(energy(b)).toBe(10200);
    const protectedBatch = structuredClone(b);
    for (let i = 0; i < 180; i++) {
      spoil(b, 15);
      spoil(protectedBatch, 15, true);
    }
    expect(mass(protectedBatch)).toBeCloseTo(3 * 0.94, 5);
    expect(mass(b)).toBeCloseTo(3 * 0.75, 5);
  });
  it('delays effects until completion; pending actions survive JSON restore and replay', () => {
    const w = world(),
      a = w.agents[0];
    const initial = structuredClone(w);
    const old = a.eco!.waterL;
    a.eco!.waterL = 1;
    initial.agents[0].eco!.waterL = 1;
    const ev = act(
      w,
      a.id,
      { intent: 'drink', action: { type: 'eco', op: 'drink', amount: 2 } },
      'd1',
    );
    expect(a.eco!.waterL).toBe(1);
    const resumed = JSON.parse(JSON.stringify(w));
    const complete = endDay(w),
      again = endDay(resumed);
    expect(a.eco!.waterL).toBe(3);
    expect(hashWorld(w)).toBe(hashWorld(resumed));
    applyEvent(initial, ev);
    applyEvent(initial, complete);
    expect(hashWorld(initial)).toBe(hashWorld(w));
    expect(again.decisionId).toBe('d1:complete');
  });
  it('failed drop cannot delete ground goods; successful drop consumes no AP', () => {
    const w = world(),
      a = w.agents[0];
    seed(w, 'wood', 2);
    const bad = runAction(w, a.id, { type: 'eco', op: 'discard', item: 'wood', amount: 1 });
    expect(bad.finish.success).toBe(false);
    expect(quantity(ecoAt(w, a.x, a.y).eco!.ground, 'wood')).toBe(2);
    const n = quantity(a.eco!.stock, 'nuts');
    const good = runAction(w, a.id, { type: 'eco', op: 'discard', item: 'nuts', amount: n });
    expect(good.finish.success).toBe(true);
    expect(a.ap).toBe(5);
    expect(quantity(a.eco!.stock, 'nuts')).toBe(0);
  });
  it('jobs reserve inputs exactly once, support co-labor and do not duplicate completion', () => {
    const w = world(),
      a = w.agents[0],
      b = w.agents[1];
    b.x = a.x;
    b.y = a.y;
    seed(w, 'flint', 1);
    expect(
      runAction(w, a.id, { type: 'eco', op: 'start_job', recipe: 'flake' }).finish.success,
    ).toBe(true);
    const j = w.ecology!.jobs[0];
    expect(quantity(ecoAt(w, a.x, a.y).eco!.ground, 'flint')).toBe(0);
    expect(runAction(w, b.id, { type: 'eco', op: 'work_job', id: j.id }).finish.success).toBe(true);
    expect(j.state).toBe('complete');
    expect(j.operators).toContain(b.id);
    expect(quantity(ecoAt(w, a.x, a.y).eco!.ground, 'flake')).toBeCloseTo(0.35);
    finishJobs(w, new Tx(w));
    expect(quantity(ecoAt(w, a.x, a.y).eco!.ground, 'flake')).toBeCloseTo(0.35);
  });
  it('all recipes complete from declared inputs, facilities and tools with no extra materials', () => {
    for (const r of Object.values(RECIPES)) {
      const w = world(),
        a = w.agents[0],
        t = ecoAt(w, a.x, a.y).eco!;
      for (const [id, n] of Object.entries(r.inputs)) seed(w, id, n);
      if (r.capability) {
        const tool = Object.entries(ITEMS).find(
          ([, d]) => (d.capabilities?.[r.capability!] ?? 0) > 0,
        )!;
        seed(w, tool[0], 20);
      }
      if (r.facility)
        t.structures.push({
          id: 'fixture',
          kind: r.facility,
          progress: BUILDINGS[r.facility].minutes,
          condition: 1,
          contents: [],
        });
      const started = runAction(w, a.id, { type: 'eco', op: 'start_job', recipe: r.id });
      expect(started.finish.success, `${r.id}: ${started.finish.text}`).toBe(true);
      const j = w.ecology!.jobs[0];
      while (j.work < r.minutes) {
        expect(runAction(w, a.id, { type: 'eco', op: 'work_job', id: j.id }).finish.success).toBe(
          true,
        );
      }
      w.tick = Math.max(1, j.readyDay);
      j.lastTended = w.tick;
      finishJobs(w, new Tx(w));
      expect(j.state, r.id).toBe('complete');
      expect(j.inputs).toHaveLength(0);
      for (const [id, n] of Object.entries(r.outputs))
        expect(quantity(t.ground, id), `${r.id}/${id}`).toBeGreaterThanOrEqual(n - 1e-5);
    }
  });
  it('sowing requires real seeds and season; a field grows and harvests only through labor', () => {
    const w = world({ startDay: 90 }),
      a = w.agents[0],
      t = ecoAt(w, a.x, a.y).eco!;
    t.fields.push({
      id: 'field',
      area: 0.25,
      stage: 'prepared',
      gdd: 0,
      work: 0,
      harvestWork: 0,
      biomass: 0,
      waterStress: 0,
      fertility: 1,
      harvestKg: 0,
    });
    expect(
      runAction(w, a.id, { type: 'eco', op: 'sow', id: 'field', crop: 'grain' }).finish.success,
    ).toBe(false);
    seed(w, 'grain', 30);
    expect(
      runAction(w, a.id, { type: 'eco', op: 'sow', id: 'field', crop: 'grain' }).finish.success,
    ).toBe(true);
    expect(quantity(t.ground, 'grain')).toBe(0);
    for (let i = 0; i < 3; i++)
      expect(
        runAction(w, a.id, { type: 'eco', op: 'sow', id: 'field', crop: 'grain' }).finish.success,
      ).toBe(true);
    for (let i = 0; i < 150; i++) {
      w.ecology!.climate = { ...climate(90 + i, 1), temperature: 20, rain: 5, drought: 1 };
      settleEcology(w, new Tx(w));
      w.tick++;
    }
    expect(t.fields[0].stage).toBe('ripe');
    a.death = undefined;
    a.hp = 100;
    const result = runAction(w, a.id, { type: 'eco', op: 'harvest', id: 'field' });
    expect(result.finish.success).toBe(true);
    expect(quantity(t.ground, 'grain')).toBeGreaterThan(0);
    expect(quantity(t.ground, 'grain')).toBeLessThan(172.5);
  });
  it('observation and model context never reveal remote agents, stocks or their plans', () => {
    const w = world({ regions: 3 }),
      a = w.agents[0],
      b = w.agents[1];
    b.eco!.region = 2;
    b.brain!.thought = 'TOPSECRET';
    const o = observeEco(w, a);
    expect(o.people.some((p) => p.id === b.id)).toBe(false);
    expect(JSON.stringify(o)).not.toContain('TOPSECRET');
    expect(o.tiles.every((t) => t.eco.region === 0)).toBe(true);
    expect(JSON.stringify(compactContext(o)).length).toBeLessThan(24000);
  });
  it('rules never accept a proposal or fabricate conversation; only explicit model agreement does', () => {
    const w = world(),
      a = w.agents[0],
      b = w.agents[1];
    b.x = a.x;
    b.y = a.y;
    w.proposals.push({
      id: 'p',
      from: b.id,
      to: a.id,
      day: 1,
      accepted: false,
      revoked: false,
      completed: false,
      attempts: {},
    });
    const o = observeEco(w, a),
      d = ruleDecision(o);
    expect(d.action.type).not.toBe('chat');
    const consent = interpret(o, {
      intent: '接受',
      agreement: { operation: 'accept', proposalId: 'p' },
    });
    expect(consent.action).toMatchObject({ type: 'chat', acceptProposalId: 'p' });
    expect(consent.brainUpdate!.brain.goal?.skill).toBe('reproduce');
  });
  it('zero model budget executes rules without requesting an API', async () => {
    const w = world({ llmDailyCalls: 0 }),
      r = makeRecord(w);
    const fetcher = async () => {
      throw Error('must not call');
    };
    const result = await requestDecision(r, async () => {}, '', fetcher as typeof fetch);
    expect(result.status).toBe('received');
    expect(result.source).not.toBe('llm');
    expect(result.attempts).toHaveLength(0);
  });
  it('ten days of deterministic runtime terminate and all snapshots replay', () => {
    const w = world({ population: 4, days: 10 }),
      replay = structuredClone(w);
    let count = 0;
    while (w.cursor.phase !== 'complete') {
      const task = nextTask(w);
      const ev = task
        ? act(w, task.agent.id, ruleDecision(observeEco(w, task.agent)), task.id)
        : endDay(w);
      applyEvent(replay, ev);
      if (++count > 20000) throw Error('scheduler failed to terminate');
    }
    expect(w.metrics).toHaveLength(10);
    expect(hashWorld(w)).toBe(hashWorld(replay));
    expect(w.agents.every((a) => a.hp >= 0)).toBe(true);
  });
});

describe('hybrid scheduling regressions', () => {
  it('a complete labor stage waits for processing rather than spinning at one-minute intervals', () => {
    const w = world(),
      a = w.agents[0],
      t = ecoAt(w, a.x, a.y).eco!;
    a.eco!.foodKcal = 6500;
    a.brain!.goal = { skill: 'make', recipe: 'fiber', expires: 10 };
    w.ecology!.jobs.push({
      id: 'retting',
      recipe: 'fiber',
      region: 0,
      x: a.x,
      y: a.y,
      started: 1,
      readyDay: 6,
      work: 120,
      inputs: [batch('bark', 5, 1, 'b', 'fixture'), batch('water', 2, 1, 'w', 'fixture')],
      operators: [a.id],
      state: 'waiting',
      quality: 1,
      lastTended: 1,
    });
    expect(ruleDecision(observeEco(w, a)).action).toEqual({ type: 'wait' });
  });
  it('zero-time actions retain the commit boundary before another prefetched actor', () => {
    const w = world({ population: 2 }),
      a = w.agents[0],
      b = w.agents[1];
    a.x = 0;
    a.y = 0;
    b.x = 10;
    b.y = 10;
    const tasks = nextBatch(w, 2);
    expect(tasks).toHaveLength(2);
    act(
      w,
      a.id,
      { intent: 'discard', action: { type: 'eco', op: 'discard', item: 'nuts', amount: 1 } },
      tasks[0].id,
    );
    expect(w.cursor.freeActions).toBeTruthy();
    endDay(w);
    expect(w.cursor.freeActions ?? 0).toBe(0);
  });
  it('inactive corpses remain observable but never receive speech', () => {
    const w = world(),
      a = w.agents[0],
      b = w.agents[1];
    b.x = a.x;
    b.y = a.y;
    b.death = { day: 1, cause: 'fixture' };
    b.corpse = { x: b.x, y: b.y, sinceDay: 1 };
    b.hp = 0;
    b.ap = 0;
    const before = b.memories.length;
    const o = observeEco(w, a);
    expect(o.people).toHaveLength(0);
    expect(o.corpses).toHaveLength(1);
    runAction(w, a.id, { type: 'shout', text: '有人吗' });
    expect(b.memories).toHaveLength(before);
    expect(a.social!.lastSpokeDay).toBe(0);
  });
  it('mutual explicit reproduction actions cause guaranteed pregnancy and a real birth after gestation', () => {
    const w = world(),
      a = w.agents[0],
      b = w.agents[1];
    b.x = a.x;
    b.y = a.y;
    a.sex = 'F';
    b.sex = 'M';
    expect(
      runAction(w, a.id, {
        type: 'chat',
        text: '愿意吗',
        proposal: { kind: 'reproduce', targetId: b.id },
      }).finish.success,
    ).toBe(true);
    const p = w.proposals[0];
    expect(
      runAction(w, b.id, { type: 'chat', text: '愿意', acceptProposalId: p.id }).finish.success,
    ).toBe(true);
    expect(runAction(w, a.id, { type: 'reproduce', proposalId: p.id }).finish.success).toBe(true);
    expect(a.pregnancy).toBeUndefined();
    expect(runAction(w, b.id, { type: 'reproduce', proposalId: p.id }).finish.success).toBe(true);
    expect(a.pregnancy?.due).toBe(281);
    w.tick = 281;
    settleEcology(w, new Tx(w));
    expect(w.agents).toHaveLength(3);
    expect(w.agents[2].age).toBe(0);
    expect(w.agents[2].eco!.stock).toEqual([]);
  });
});

describe('physical economy edge cases', () => {
  it('partly processed inputs are not fully refunded or completed after cancellation', () => {
    const w = world(),
      a = w.agents[0];
    seed(w, 'stone', 1.5);
    runAction(w, a.id, { type: 'eco', op: 'start_job', recipe: 'handaxe' });
    const j = w.ecology!.jobs[0];
    runAction(w, a.id, { type: 'eco', op: 'work_job', id: j.id });
    expect(j.work).toBe(120);
    expect(runAction(w, a.id, { type: 'eco', op: 'cancel_job', id: j.id }).finish.success).toBe(
      true,
    );
    const ground = ecoAt(w, a.x, a.y).eco!.ground;
    expect(quantity(ground, 'stone')).toBeCloseTo(0.5);
    expect(quantity(ground, 'handaxe')).toBe(0);
    finishJobs(w, new Tx(w));
    expect(quantity(ground, 'stone')).toBeCloseTo(0.5);
    expect(j.inputs).toEqual([]);
  });
  it('finite mineral extraction does not regrow and storage capacity prevents oversubscription', () => {
    const w = world(),
      a = w.agents[0],
      t = ecoAt(w, a.x, a.y).eco!,
      dep = t.deposits.find((d) => d.item === 'flint')!;
    dep.kg = 0.1;
    runAction(w, a.id, { type: 'eco', op: 'collect', item: 'flint', amount: 1 });
    expect(dep.kg).toBe(0);
    settleEcology(w, new Tx(w));
    expect(dep.kg).toBe(0);
    t.structures.push({
      id: 'store',
      kind: 'camp',
      progress: BUILDINGS.camp.minutes,
      condition: 1,
      contents: [batch('stone', 50, 1, 'full', 'fixture')],
    });
    a.eco!.stock.push(batch('wood', 1, 1, 'wood', 'fixture'));
    expect(
      runAction(w, a.id, {
        type: 'eco',
        op: 'transfer',
        destination: 'storage',
        id: 'store',
        item: 'wood',
        amount: 1,
      }).finish.success,
    ).toBe(false);
    expect(quantity(a.eco!.stock, 'wood')).toBe(1);
  });
  it('a vehicle can move actual cargo, while a tiny vehicle fragment adds no carrying capacity', async () => {
    const { capacity, capability } = await import('../src/ecology/batches');
    expect(capacity([batch('canoe', 0.01, 1, 'fragment', 'fixture')], 15)).toBe(15);
    expect(capability([[batch('canoe', 0.01, 1, 'fragment', 'fixture')]], 'boat')).toBe(0);
    const w = world(),
      a = w.agents[0];
    seed(w, 'canoe', 100);
    expect(
      runAction(w, a.id, {
        type: 'eco',
        op: 'transfer',
        destination: 'bag',
        item: 'canoe',
        amount: 100,
      }).finish.success,
    ).toBe(true);
    expect(capability([a.eco!.stock], 'boat')).toBe(1);
    expect(capacity(a.eco!.stock, 15)).toBe(315);
  });
  it('phased sowing persists seed investment and never charges it twice after restoring', () => {
    const w = world({ startDay: 90 }),
      a = w.agents[0],
      t = ecoAt(w, a.x, a.y).eco!;
    t.fields.push({
      id: 's',
      area: 0.25,
      stage: 'prepared',
      gdd: 0,
      work: 0,
      harvestWork: 0,
      biomass: 0,
      waterStress: 0,
      fertility: 1,
      harvestKg: 0,
    });
    seed(w, 'grain', 30);
    expect(
      runAction(w, a.id, { type: 'eco', op: 'sow', id: 's', crop: 'grain' }).finish.success,
    ).toBe(true);
    expect(t.fields[0].stage).toBe('prepared');
    const restored = JSON.parse(JSON.stringify(w));
    for (let i = 0; i < 3; i++)
      expect(
        runAction(restored, a.id, { type: 'eco', op: 'sow', id: 's', crop: 'grain' }).finish
          .success,
      ).toBe(true);
    expect(ecoAt(restored, a.x, a.y).eco!.fields[0].stage).toBe('growing');
    expect(quantity(ecoAt(restored, a.x, a.y).eco!.ground, 'grain')).toBe(0);
  });
});

describe('industry reachability and explicit high-level choices', () => {
  it('every recipe input has an ecological source or a reachable upstream process', () => {
    const w = world({ regions: 3 });
    const reachable = new Set(
      w.tiles.flatMap((t) => [
        ...Object.keys(t.eco!.biomass),
        ...t.eco!.deposits.map((d) => d.item),
      ]),
    );
    for (const id of ['water', 'meat', 'bone', 'hide', 'fat', 'feather', 'milk', 'manure'])
      reachable.add(id);
    for (let i = 0; i < 60; i++)
      for (const r of Object.values(RECIPES))
        if (Object.keys(r.inputs).every((id) => reachable.has(id)))
          for (const id of Object.keys(r.outputs)) reachable.add(id);
    expect(
      Object.values(RECIPES).filter((r) => Object.keys(r.inputs).some((id) => !reachable.has(id))),
    ).toEqual([]);
  });
  it('hunting goals produce real animal inputs including the feathers needed by arrows', () => {
    const w = world(),
      a = w.agents[0],
      t = w.tiles.find((t) => t.eco!.biome === 'forest')!;
    a.x = t.x;
    a.y = t.y;
    a.eco!.stock.push(batch('spear', 1.2, 1, 'spear', 'fixture'));
    const before = t.eco!.biomass.game;
    const d = interpret(observeEco(w, a), { intent: '狩猎', goal: { skill: 'hunt', expires: 5 } });
    expect(d.action).toMatchObject({ type: 'eco', op: 'collect', item: 'meat' });
    expect(runAction(w, a.id, d.action).finish.success).toBe(true);
    expect(t.eco!.biomass.game).toBeLessThan(before);
    expect(quantity(t.eco!.ground, 'feather')).toBeGreaterThanOrEqual(0.02);
    expect(quantity(t.eco!.ground, 'bone')).toBeGreaterThan(0);
  });
  it('the model can explicitly choose full observation and physical conflict', () => {
    const w = world(),
      a = w.agents[0],
      b = w.agents[1];
    b.x = a.x;
    b.y = a.y;
    const survey = interpret(observeEco(w, a), {
      intent: '仔细看四周',
      goal: { skill: 'survey', expires: 2 },
    });
    expect(survey.action).toEqual({ type: 'survey' });
    runAction(w, a.id, survey.action);
    expect(a.eco!.survey?.tiles.length).toBeGreaterThan(9);
    const attack = interpret(observeEco(w, a), {
      intent: '明确攻击',
      goal: { skill: 'confront', targetId: b.id, expires: 2 },
    });
    expect(attack.action).toEqual({ type: 'attack', targetId: b.id });
    b.brain!.combatPolicy = { mode: 'fight' };
    runAction(w, a.id, attack.action);
    expect(b.hp).toBe(80);
  });
  it('discarded prefetch attempts still count toward personal quotas', () => {
    const w = world(),
      a = w.agents[0],
      r = makeRecord(w);
    r.decision = ruleDecision(observeEco(w, a));
    r.attempts = [
      { status: 200, elapsedMs: 1, usage: { prompt_tokens: 20, completion_tokens: 10 } },
    ];
    account(w, r);
    expect(r.decision.brainUpdate!.brain.callsDay).toBe(1);
    expect(r.decision.brainUpdate!.brain.tokensDay).toBe(30);
    expect(w.usage.calls).toBe(1);
  });
  it('a live proposal is a dependency even across regions', async () => {
    const { conflicts } = await import('../src/sim/scheduler');
    const w = world({ regions: 3 }),
      a = w.agents[0],
      b = w.agents[1];
    b.eco!.region = 2;
    expect(conflicts(w, a, b)).toBe(false);
    w.proposals.push({
      id: 'cross',
      from: a.id,
      to: b.id,
      day: 1,
      accepted: true,
      revoked: false,
      completed: false,
      attempts: {},
    });
    expect(conflicts(w, a, b)).toBe(true);
  });
});
