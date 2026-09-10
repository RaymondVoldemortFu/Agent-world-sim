import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { observeEco, minutesFor } from '../src/ecology/engine';
import { ecoAt } from '../src/ecology/world';
import { BUILDINGS } from '../src/ecology/catalog';
import { BrainOutputSchema } from '../src/ecology/types';
import { navigate } from '../src/brain/navigation';
import { interpret, ruleDecision, shouldThink } from '../src/brain/controller';
import { fightBeast } from '../src/ecology/wildlife';
import { Tx } from '../src/sim/transaction';
const fixture = () => {
  const w = createWorld(
    { worldModel: 'ecology', population: 1, regions: 1, wildlifeEnabled: false },
    'nav-test',
  );
  w.tiles.forEach((t) => {
    t.eco!.biome = 'meadow';
  });
  const a = w.agents[0];
  a.x = 5;
  a.y = 5;
  for (const y of [4, 5, 6]) ecoAt(w, 6, y).eco!.biome = 'water';
  a.brain!.places = w.tiles
    .filter((t) => t.x >= 3 && t.x <= 9 && t.y >= 2 && t.y <= 8)
    .map((t) => ({ x: t.x, y: t.y, region: 0, day: 1, food: 0, biome: t.eco!.biome }));
  return { w, a };
};
it('finds a shortest cardinal detour, uses a completed bridge, and rejects invalid destinations', () => {
  const { w, a } = fixture();
  expect(navigate(observeEco(w, a), 7, 5).steps).toBe(6);
  ecoAt(w, 6, 5).eco!.structures.push({
    id: 'bridge',
    kind: 'bridge',
    progress: BUILDINGS.bridge.minutes,
    condition: 1,
    contents: [],
  });
  expect(navigate(observeEco(w, a), 7, 5).steps).toBe(2);
  expect(navigate(observeEco(w, a), 15, 5).status).toBe('blocked');
  expect(
    BrainOutputSchema.safeParse({ intent: '', goal: { skill: 'navigate', expires: 2 } }).success,
  ).toBe(false);
});
it('persists navigation through hunger, loneliness and return rules and finishes at the actual destination', () => {
  const { w, a } = fixture();
  a.brain!.movement = { holdUntil: 1000, returnAfterGather: true };
  a.brain!.forageTrip = { origin: [0, 0], region: 0, returning: true };
  a.social!.loneliness = 40;
  a.eco!.stock = [];
  const before = structuredClone(w),
    events = [];
  let d = interpret(observeEco(w, a), {
    intent: '离开这里',
    goal: { skill: 'navigate', x: 7, y: 5, expires: 5 },
  });
  expect(d.brainUpdate!.brain.movement?.holdUntil).toBeUndefined();
  let spentMinutes = 0;
  for (let i = 0; i < 10; i++) {
    expect(d.action.type).toBe('move');
    spentMinutes += minutesFor(w, a, d.action);
    events.push(act(w, 1, d, `nav-${i}`), endDay(w));
    if (a.brain!.navigation?.status === 'arrived') break;
    d = ruleDecision(observeEco(w, a));
  }
  expect([a.x, a.y]).toEqual([7, 5]);
  expect(events).toHaveLength(12);
  expect(a.brain!.goal).toBeUndefined();
  expect(a.ap).toBeCloseTo(w.config.dailyAP - spentMinutes / 120);
  events.forEach((e) => applyEvent(before, e));
  expect(hashWorld(before)).toBe(hashWorld(w));
});
it('avoids visible beasts, reports blocked paths and retains destination after emergency escape', () => {
  const { w, a } = fixture();
  w.tiles.forEach((t) => {
    t.eco!.biome = 'meadow';
  });
  a.brain!.places = [];
  const beast = {
    id: 'bear',
    species: 'bear' as const,
    region: 0,
    x: 6,
    y: 5,
    hp: 180,
    maxHp: 180,
    attack: 24,
    born: 0,
    mode: 'raiding' as const,
  };
  w.ecology!.beasts = [beast];
  expect(navigate(observeEco(w, a), 8, 5).action).not.toMatchObject({ dx: 1, dy: 0 });
  a.brain!.goal = { skill: 'navigate', x: 1, y: 1, expires: 4 };
  w.rng = 0;
  fightBeast(w, new Tx(w), beast, 1);
  expect(a.brain!.goal?.skill).toBe('navigate');
  expect(a.hp).toBe(100);
  a.x = 5;
  a.y = 5;
  w.ecology!.beasts = [];
  w.tiles.forEach((t) => {
    if (t.x !== 5 || t.y !== 5) t.eco!.biome = 'water';
  });
  const d = ruleDecision(observeEco(w, a));
  expect(d.brainUpdate!.brain.navigation?.status).toBe('blocked');
  expect(d.action.type).toBe('wait');
  a.brain = d.brainUpdate!.brain;
  expect(shouldThink(observeEco(w, a))).toBe(true);
});
