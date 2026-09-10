import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { observeEco } from '../src/ecology/engine';
import { ecoAt } from '../src/ecology/world';
import { batch, quantity } from '../src/ecology/batches';
import { interpret, ruleDecision, compactContext, shouldThink } from '../src/brain/controller';

it('executes a farm promise after speaking using granary seed, and exposes real sowing progress', () => {
  const w = createWorld(
    {
      worldModel: 'ecology',
      ecoPreset: 'village',
      population: 20,
      wildlifeEnabled: false,
      startDay: 100,
    },
    'farm-regression',
  );
  const a = w.agents[0],
    v = w.ecology!.village!;
  a.x = v.x;
  a.y = v.y;
  a.eco!.foodKcal = 6500;
  a.eco!.waterL = 6;
  a.eco!.stock = [batch('grain', 3, w.tick, 'own', 'test')];
  const t = ecoAt(w, a.x, a.y).eco!,
    f = t.fields[0];
  f.stage = 'prepared';
  delete f.crop;
  delete f.seededKg;
  const granary = t.structures.find((s) => s.kind === 'granary')!;
  const beforeSeed = quantity(granary.contents, 'grain') + quantity(a.eco!.stock, 'grain');
  const replay = structuredClone(w);
  const speech = interpret(observeEco(w, a), {
    intent: '今天播种',
    goal: { skill: 'farm', item: 'grain', x: a.x, y: a.y, expires: 5 },
    speech: { channel: 'public_speak', text: '我来播种' },
  });
  const events = [act(w, a.id, speech, 'promise'), endDay(w)];
  const work = ruleDecision(observeEco(w, a));
  expect(work.action).toMatchObject({ type: 'eco', op: 'sow', id: f.id });
  events.push(act(w, a.id, work, 'actual-sow'), endDay(w));
  expect(f.seededKg).toBeCloseTo(f.area * 120);
  expect(f.sowingWork).toBe(120);
  expect(
    beforeSeed - quantity(granary.contents, 'grain') - quantity(a.eco!.stock, 'grain'),
  ).toBeCloseTo(f.seededKg!);
  const card = compactContext(observeEco(w, a)).nearby.find((t) => t.x === a.x && t.y === a.y)!
    .fields[0];
  expect(card.sowingWork).toBe(120);
  expect(card.seededKg).toBe(f.seededKg);
  events.forEach((e) => applyEvent(replay, e));
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('reports out-of-season farming instead of silently waiting or repeatedly failing sow', () => {
  const w = createWorld(
    {
      worldModel: 'ecology',
      ecoPreset: 'village',
      population: 1,
      wildlifeEnabled: false,
      startDay: 200,
    },
    'blocked-farm',
  );
  const a = w.agents[0],
    v = w.ecology!.village!;
  a.x = v.x;
  a.y = v.y;
  const f = ecoAt(w, a.x, a.y).eco!.fields[0];
  f.stage = 'prepared';
  a.eco!.foodKcal = 6500;
  a.eco!.waterL = 6;
  a.eco!.stock = [batch('grain', 3, w.tick, 'own', 'test')];
  a.brain!.goal = { skill: 'farm', item: 'grain', expires: 10 };
  const d = ruleDecision(observeEco(w, a));
  expect(d.action.type).toBe('wait');
  expect(d.brainUpdate!.brain.goalBlocked).toContain('播种季节');
  a.brain = d.brainUpdate!.brain;
  expect(shouldThink(observeEco(w, a))).toBe(true);
});
