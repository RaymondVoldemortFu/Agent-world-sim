import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { observeEco } from '../src/ecology/engine';
import { ecoAt } from '../src/ecology/world';
import { batch, mass } from '../src/ecology/batches';
import { BUILDINGS } from '../src/ecology/catalog';
import { validateEcology } from '../src/ecology/invariants';
import { BrainOutputSchema } from '../src/ecology/types';
import {
  interpret,
  ruleDecision,
  shouldThink,
  holdingPosition,
  compactContext,
  remember,
} from '../src/brain/controller';

const world = () => {
  const w = createWorld(
    { worldModel: 'ecology', regions: 1, population: 2, wildlifeEnabled: false },
    'movement-test',
  );
  for (const a of w.agents) {
    a.x = 5;
    a.y = 5;
    a.eco!.foodKcal = 6500;
    a.eco!.waterL = 6;
    a.eco!.stock = [batch('grain', 3, 1, `food-${a.id}`, 'test')];
  }
  for (const t of w.tiles) {
    t.eco!.biome = 'meadow';
    t.eco!.biomass = {};
    t.eco!.ground = [];
  }
  return w;
};
describe('durable movement directives', () => {
  it('validates directives and keeps timed holds across day boundaries until expiry or cancellation', () => {
    expect(BrainOutputSchema.safeParse({ intent: '', movement: { stayMinutes: -1 } }).success).toBe(
      false,
    );
    const w = world(),
      a = w.agents[0];
    w.ecology!.clock = 480;
    const d = interpret(
      observeEco(w, a),
      BrainOutputSchema.parse({
        intent: '等待同伴',
        movement: { stayMinutes: 240, returnAfterGather: true },
        goal: { skill: 'explore', x: 7, y: 5, expires: 5 },
      }),
    );
    expect(d.action.type).toBe('wait');
    const initial = structuredClone(w);
    const events = [act(w, a.id, d, 'hold'), endDay(w)];
    events.forEach((e) => applyEvent(initial, e));
    expect(hashWorld(initial)).toBe(hashWorld(w));
    w.tick = 2;
    w.ecology!.clock = 119;
    expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
    w.ecology!.clock = 120;
    expect(ruleDecision(observeEco(w, a)).action.type).toBe('move');
    const hold = interpret(observeEco(w, a), { intent: '继续等', movement: { stayMinutes: 200 } });
    a.brain = hold.brainUpdate!.brain;
    const release = interpret(observeEco(w, a), {
      intent: '离开',
      movement: { stayMinutes: 0, returnAfterGather: false },
    });
    expect(release.action.type).toBe('move');
    expect(holdingPosition(observeEco(w, a), release.brainUpdate!.brain)).toBe(false);
  });
  it('holds allow local food and work, suppress escape and travel, and let the model reconsider', () => {
    const w = world(),
      a = w.agents[0];
    a.brain!.movement = { holdUntil: 600 };
    a.eco!.stock = [];
    a.eco!.foodKcal = 3000;
    ecoAt(w, 5, 5).eco!.biomass.nuts = 1;
    ecoAt(w, 6, 5).eco!.biomass.nuts = 20;
    expect(ruleDecision(observeEco(w, a)).action).toMatchObject({ type: 'eco', op: 'collect' });
    delete ecoAt(w, 5, 5).eco!.biomass.nuts;
    expect(ruleDecision(observeEco(w, a)).action.type).toBe('wait');
    expect(shouldThink(observeEco(w, a))).toBe(true);
    w.ecology!.beasts = [
      {
        id: 'b',
        species: 'bear',
        region: 0,
        x: 6,
        y: 5,
        hp: 180,
        maxHp: 180,
        attack: 24,
        born: 0,
        mode: 'raiding',
      },
    ];
    expect(ruleDecision(observeEco(w, a)).action.type).toBe('move');
    expect(ruleDecision(observeEco(w, a)).brainUpdate!.brain.movement?.holdUntil).toBeUndefined();
    a.x = 0;
    const d = interpret(observeEco(w, a), {
      intent: '跨区计划',
      goal: { skill: 'explore', region: 1, expires: 5 },
    });
    expect(d.action.type).toBe('wait');
    expect(compactContext(observeEco(w, a)).self.movement.stayMinutesLeft).toBe(600);
  });
  it('marks actual successful foraging for return and replays the trip state', () => {
    const w = world(),
      a = w.agents[0];
    a.eco!.stock = [];
    a.brain!.movement = { returnAfterGather: true };
    ecoAt(w, 6, 5).eco!.biomass.nuts = 20;
    const initial = structuredClone(w),
      events = [];
    const move = ruleDecision(observeEco(w, a));
    expect(move.action.type).toBe('move');
    events.push(act(w, 1, move, 'out'), endDay(w));
    expect(a.brain!.forageTrip?.origin).toEqual([5, 5]);
    const collect = ruleDecision(observeEco(w, a));
    expect(collect.action).toMatchObject({ type: 'eco', op: 'collect' });
    events.push(act(w, 1, collect, 'food'), endDay(w));
    expect(a.brain!.forageTrip?.returning).toBe(true);
    const back = ruleDecision(observeEco(w, a));
    expect(back.action).toMatchObject({ type: 'move', dx: -1, dy: 0 });
    events.push(act(w, 1, back, 'back'), endDay(w));
    expect(remember(observeEco(w, a)).forageTrip).toBeUndefined();
    events.forEach((e) => applyEvent(initial, e));
    expect(hashWorld(initial)).toBe(hashWorld(w));
  });
  it('failed collection never counts as a successful return trip', () => {
    const w = world(),
      a = w.agents[0];
    a.brain!.forageTrip = { origin: [4, 5], region: 0, returning: false };
    act(
      w,
      1,
      { intent: '', action: { type: 'eco', op: 'collect', item: 'nuts', amount: 1 } },
      'failed',
    );
    expect(endDay(w).success).toBe(false);
    expect(a.brain!.forageTrip.returning).toBe(false);
  });
  it('gather goals honor both return choices and replace obsolete procurement', () => {
    for (const returnAfterGather of [true, false]) {
      const w = world(),
        a = w.agents[0];
      a.brain!.procurement = { item: 'clay', need: 10, site: [0, 0] };
      ecoAt(w, 6, 5).eco!.biomass.wood = 20;
      const d = interpret(observeEco(w, a), {
        intent: '采木',
        movement: { returnAfterGather },
        goal: { skill: 'gather', item: 'wood', quantity: 2, expires: 3 },
      });
      expect(d.brainUpdate!.brain.procurement).toBeUndefined();
      expect(d.action.type).toBe('move');
      a.brain = d.brainUpdate!.brain;
      a.x = 6;
      a.eco!.stock.push(batch('wood', 2, 1, 'wood', 'test'));
      const next = ruleDecision(observeEco(w, a));
      expect(next.action.type).toBe(returnAfterGather ? 'move' : 'wait');
      if (!returnAfterGather) expect(next.brainUpdate!.brain.goal).toBeUndefined();
    }
  });
});

describe('initial farming village', () => {
  it('creates deterministic finite estates on four adjacent dry tiles in every season', () => {
    for (const population of [1, 20, 60])
      for (const startDay of [1, 85, 160, 250, 300]) {
        const config = {
          worldModel: 'ecology' as const,
          ecoPreset: 'village' as const,
          population,
          startDay,
          size: 10,
          regions: 1,
          seed: startDay,
        };
        const w = createWorld(config, 'village-test');
        expect(hashWorld(w)).toBe(hashWorld(createWorld(config, 'village-test')));
        validateEcology(w);
        expect(w.config.spawn).toBe('compact');
        const village = w.ecology!.village!;
        expect(village.farmlandHa).toBeCloseTo(population * 0.35);
        const tiles = w.tiles.filter((t) => t.eco!.fields.length);
        expect(tiles).toHaveLength(4);
        expect(tiles.reduce((n, t) => n + t.eco!.fields[0].area, 0)).toBeCloseTo(
          village.farmlandHa,
        );
        expect(
          tiles
            .flatMap((t) => t.eco!.structures)
            .filter((s) => s.kind === 'granary')
            .reduce((n, s) => n + mass(s.contents), 0),
        ).toBeCloseTo(village.foodKg + village.seedKg);
        for (const a of w.agents) {
          const tile = ecoAt(w, a.x, a.y).eco!;
          expect(tile.biome).not.toBe('water');
          expect(tile.structures.some((s) => BUILDINGS[s.kind].shelter > 0)).toBe(true);
          expect(a.eco!.knowledge).toContain('farming');
          expect(a.brain!.movement?.returnAfterGather).toBe(true);
        }
        if (startDay === 160) expect(tiles[0].eco!.fields[0].stage).toBe('growing');
        if (startDay === 85 || startDay === 250)
          expect(tiles[0].eco!.fields[0].stage).toBe('prepared');
      }
  });
});
