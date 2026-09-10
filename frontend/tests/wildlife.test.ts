import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { Tx } from '../src/sim/transaction';
import { conflicts } from '../src/sim/scheduler';
import {
  settlements,
  fightBeast,
  combatView,
  advanceWildlife,
  WILDLIFE_RULES,
} from '../src/ecology/wildlife';
import { ecoAt } from '../src/ecology/world';
import { observeEco } from '../src/ecology/engine';
import { batch } from '../src/ecology/batches';
import { ITEMS, BUILDINGS, catalogErrors } from '../src/ecology/catalog';
import { compactContext, interpret } from '../src/brain/controller';
import type { Beast } from '../src/ecology/types';
const make = (extra = {}) =>
  createWorld(
    { worldModel: 'ecology', population: 6, regions: 3, days: 5, spawn: 'compact', ...extra },
    'wildlife-test',
  );
const enemy = (overrides: Partial<Beast> = {}): Beast => ({
  id: 'test-beast',
  species: 'bear',
  region: 0,
  x: 5,
  y: 5,
  hp: 180,
  maxHp: 180,
  attack: 24,
  born: 0,
  mode: 'raiding',
  ...overrides,
});
const place = (w: ReturnType<typeof make>) =>
  w.agents.forEach((a) => {
    a.x = 5;
    a.y = 5;
    a.brain!.combatPolicy = { mode: 'fight' };
  });

describe('wildlife and combat', () => {
  it('serializes decisions that can observe a shared beast defender', () => {
    const w = make({ population: 2 });
    w.agents[0].x = 3;
    w.agents[0].y = 5;
    w.agents[1].x = 8;
    w.agents[1].y = 5;
    w.ecology!.beasts = [enemy({ x: 4 })];
    expect(conflicts(w, w.agents[0], w.agents[1])).toBe(true);
    w.ecology!.beasts = [];
    expect(conflicts(w, w.agents[0], w.agents[1])).toBe(false);
  });
  it('spawns outside settlement and personal space, including empty regions, deterministically', () => {
    for (const seed of [0, 1, 42, 987]) {
      const w = make({ seed });
      expect(hashWorld(w)).toBe(hashWorld(make({ seed })));
      const towns = settlements(w);
      expect(towns.length).toBe(1);
      for (const b of w.ecology!.beasts!) {
        expect(ecoAt(w, b.x, b.y, b.region).eco!.biome).not.toBe('water');
        expect(b.hp).toBeGreaterThanOrEqual(180);
        expect(b.attack).toBeGreaterThanOrEqual(24);
        for (const a of w.agents.filter((a) => a.eco!.region === b.region))
          expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(3);
        if (b.mode === 'raiding')
          expect(
            towns.some(
              (s) =>
                s.region === b.region && Math.max(Math.abs(s.x - b.x), Math.abs(s.y - b.y)) <= 5,
            ),
          ).toBe(true);
      }
      expect(w.ecology!.beasts!.some((b) => b.region === 1)).toBe(true);
      expect(w.ecology!.beasts!.some((b) => b.region === 2)).toBe(true);
      expect(w.agents[0].personality[2]).toBe(0.85);
    }
  });
  it('recognizes completed infrastructure even without residents and ignores unfinished construction', () => {
    const w = make({ population: 1, wildlifeEnabled: false });
    const t = ecoAt(w, 5, 5).eco!;
    t.structures = ['hearth', 'granary', 'pen'].map((kind, i) => ({
      id: `s${i}`,
      kind,
      condition: 1,
      progress: 0,
      contents: [],
    }));
    expect(settlements(w)).toHaveLength(0);
    t.structures.forEach((s) => (s.progress = BUILDINGS[s.kind].minutes));
    expect(settlements(w)).toHaveLength(1);
    t.structures.forEach((s) => (s.condition = 0));
    expect(settlements(w)).toHaveLength(0);
  });
  it('a healthy solitary adult cannot defeat even the weakest beast barehanded, while a group can', () => {
    for (let seed = 0; seed < 12; seed++) {
      const solo = make({ population: 1, wildlifeEnabled: false, seed });
      place(solo);
      const beast = enemy();
      fightBeast(solo, new Tx(solo), beast, 50);
      expect(solo.agents[0].death?.cause).toContain('野兽袭击');
      expect(beast.hp).toBeGreaterThan(0);
      const group = make({ wildlifeEnabled: false, seed });
      place(group);
      const threat = enemy();
      fightBeast(group, new Tx(group), threat, 50);
      expect(threat.hp).toBe(0);
      expect(group.agents.filter((a) => !a.death).length).toBeGreaterThanOrEqual(4);
      expect(ecoAt(group, 5, 5).eco!.ground.some((b) => b.item === 'hide')).toBe(true);
    }
  });
  it('uses a single complete carried weapon, armor and compatible shield with durability', () => {
    const w = make({ population: 1, wildlifeEnabled: false });
    const a = w.agents[0];
    a.eco!.stock = [batch('iron_spear', 0.1, 1, 'fragment', 'test')];
    expect(combatView(a).attack).toBe(6);
    a.eco!.stock = [
      batch('iron_spear', ITEMS.iron_spear.unitKg!, 1, 'spear', 'test'),
      batch('leather_armor', 3, 1, 'armor', 'test'),
      batch('wooden_shield', 2.5, 1, 'shield', 'test'),
    ];
    expect(combatView(a).attack).toBe(40);
    expect(combatView(a).protection).toBeCloseTo(1 - 0.75 * 0.82);
    a.eco!.stock[0].wear = ITEMS.iron_spear.durability;
    expect(combatView(a).attack).toBe(6);
    a.eco!.stock.push(batch('bow', 1.2, 1, 'bow', 'test'));
    expect(combatView(a).shield).toBe('none');
    expect(catalogErrors()).toEqual([]);
  });
  it('equipped defenders survive a strong beast that defeats an unarmed individual', () => {
    const w = make({ population: 3, wildlifeEnabled: false });
    place(w);
    for (const a of w.agents)
      a.eco!.stock = [
        batch('iron_spear', 1.8, 1, `s${a.id}`, 'test'),
        batch('bronze_armor', 5, 1, `a${a.id}`, 'test'),
        batch('wooden_shield', 2.5, 1, `d${a.id}`, 'test'),
      ];
    const b = enemy({ hp: 260, maxHp: 260, attack: 36 });
    fightBeast(w, new Tx(w), b, 20);
    expect(b.hp).toBe(0);
    expect(w.agents.every((a) => !a.death)).toBe(true);
    expect(w.agents[0].eco!.stock.some((b) => (b.wear ?? 0) > 0)).toBe(true);
  });
  it('moves raiders toward a settlement on land, caps spawning and damages undefended farms/buildings', () => {
    const w = make({ population: 1, wildlifeEnabled: false });
    w.agents[0].x = 0;
    w.agents[0].y = 0;
    for (const t of w.tiles.filter((t) => t.eco!.region === 0)) t.eco!.biome = 'meadow';
    const t = ecoAt(w, 5, 5).eco!;
    t.structures = ['hearth', 'granary', 'pen'].map((kind, i) => ({
      id: `s${i}`,
      kind,
      condition: 1,
      progress: BUILDINGS[kind].minutes,
      contents: [],
    }));
    w.ecology!.beasts = [enemy({ x: 2, y: 5 })];
    w.tick = 2;
    advanceWildlife(w, new Tx(w));
    expect(w.ecology!.beasts[0].x).toBe(3);
    w.tick = 3;
    advanceWildlife(w, new Tx(w));
    expect(t.structures[0].condition).toBeLessThan(1);
    for (let day = 5; day <= 25; day += 5) {
      w.tick = day;
      advanceWildlife(w, new Tx(w));
    }
    for (let region = 0; region < 3; region++)
      expect(
        w.ecology!.beasts.filter((b) => b.hp > 0 && b.region === region).length,
      ).toBeLessThanOrEqual(WILDLIFE_RULES.maxPerRegion);
  });
  it('limits perception, supplies defend goals and replays wildlife damage and deaths exactly', () => {
    const w = make({ population: 1 });
    place(w);
    w.ecology!.beasts = [
      enemy(),
      enemy({ id: 'distant', x: 9, y: 9 }),
      enemy({ id: 'foreign', region: 1 }),
    ];
    const observation = observeEco(w, w.agents[0]);
    expect(observation.beasts?.map((b) => b.id)).toEqual(['test-beast']);
    expect(compactContext(observation).beasts).toHaveLength(1);
    const d = interpret(observation, {
      intent: '防守',
      goal: { skill: 'defend', item: 'test-beast', expires: 3 },
    });
    expect(d.action).toMatchObject({ type: 'eco', op: 'fight_beast', item: 'test-beast' });
    w.agents[0].ap = 0;
    w.agents[0].hp = 10;
    const replay = structuredClone(w);
    const ev = endDay(w);
    expect(ev.type).toBe('wildlife');
    expect(w.agents[0].death?.cause).toContain('野兽');
    applyEvent(replay, ev);
    expect(hashWorld(replay)).toBe(hashWorld(w));
    const following = endDay(w);
    expect(following.type).toBe('day_end');
  });
  it('fight actions resolve through the existing scheduled action path and preserve replay', () => {
    const w = make({ population: 6 });
    place(w);
    w.ecology!.beasts = [enemy({ hp: 20 })];
    const replay = structuredClone(w);
    const start = act(
      w,
      1,
      { intent: '共同防御', action: { type: 'eco', op: 'fight_beast', item: 'test-beast' } },
      'fight',
    );
    const finish = endDay(w);
    expect(finish.type).toBe('fight_beast');
    expect(w.ecology!.beasts[0].hp).toBe(0);
    applyEvent(replay, start);
    applyEvent(replay, finish);
    expect(hashWorld(replay)).toBe(hashWorld(w));
  });
});
