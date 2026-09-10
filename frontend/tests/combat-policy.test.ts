import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { Tx } from '../src/sim/transaction';
import { fightBeast, fleeCombat } from '../src/ecology/wildlife';
import { fleeProbability } from '../src/ecology/combat-policy';
import { observeEco } from '../src/ecology/engine';
import { interpret, compactContext } from '../src/brain/controller';
import { BrainOutputSchema } from '../src/ecology/types';
const fixture = () => {
  const w = createWorld(
    { worldModel: 'ecology', population: 2, regions: 1, wildlifeEnabled: false },
    'retreat-test',
  );
  w.tiles.forEach((t) => (t.eco!.biome = 'meadow'));
  w.agents.forEach((a) => {
    a.x = 5;
    a.y = 5;
  });
  const beast = {
    id: 'bear',
    species: 'bear' as const,
    region: 0,
    x: 5,
    y: 5,
    hp: 260,
    maxHp: 260,
    attack: 36,
    born: 0,
    mode: 'raiding' as const,
  };
  w.ecology!.beasts = [beast];
  return { w, a: w.agents[0], beast };
};
it('health controls seeded escape rates and each round permits only one attempt', () => {
  expect(fleeProbability(100)).toBeCloseTo(0.9);
  expect(fleeProbability(60)).toBeCloseTo(0.58);
  expect(fleeProbability(20)).toBeCloseTo(0.26);
  const counts: number[] = [];
  for (const hp of [20, 100]) {
    const { w, a, beast } = fixture();
    let escaped = 0;
    for (let seed = 0; seed < 500; seed++) {
      a.x = 5;
      a.y = 5;
      a.hp = hp;
      w.rng = Math.imul(seed, 2654435761) >>> 0;
      const tx = new Tx(w),
        attempts = new Set<number>();
      const result = fleeCombat(w, tx, a, beast, attempts)!;
      if (result.escaped) escaped++;
      else {
        expect([a.x, a.y]).toEqual([5, 5]);
        const rng = w.rng;
        a.hp = Math.max(1, a.hp - 10);
        expect(fleeCombat(w, tx, a, beast, attempts)).toBeUndefined();
        expect(w.rng).toBe(rng);
      }
    }
    counts.push(escaped);
    expect(escaped / 500).toBeCloseTo(fleeProbability(hp), 1);
  }
  expect(counts[1]).toBeGreaterThan(counts[0] * 2);
});
it('a failed attempt leaves the actor vulnerable and its RNG and event replay are deterministic', () => {
  const { w, a, beast } = fixture();
  w.agents[1].x = 0;
  w.agents[1].y = 0;
  a.hp = 20;
  w.rng = 1000;
  const before = structuredClone(w),
    tx = new Tx(w);
  const lines = fightBeast(w, tx, beast, 1);
  expect(lines.filter((line) => line.includes('撤退失败'))).toHaveLength(1);
  expect(a.death?.cause).toContain('野兽');
  const event = tx.finish('wildlife', lines.join('；'), 'failed-retreat', true);
  applyEvent(before, event);
  expect(hashWorld(before)).toBe(hashWorld(w));
});
it('defaults to fleeing with exhausted AP, records danger and replays interrupted work', () => {
  const { w, a, beast } = fixture();
  a.brain!.movement = { holdUntil: 1000 };
  a.brain!.goal = { skill: 'gather', item: 'wood', expires: 5 };
  act(
    w,
    a.id,
    { intent: '采集', action: { type: 'eco', op: 'collect', item: 'wood', amount: 1 } },
    'pending',
  );
  a.ap = 0;
  const before = structuredClone(w),
    tx = new Tx(w);
  const lines = fightBeast(w, tx, beast, 3);
  const e = tx.finish('wildlife', lines.join('；'), 'escape', true);
  expect(a.hp).toBe(100);
  expect(a.ap).toBe(0);
  expect(Math.max(Math.abs(a.x - 5), Math.abs(a.y - 5))).toBeGreaterThan(1);
  expect(w.ecology!.pending).toHaveLength(0);
  expect(a.brain!.goal).toBeUndefined();
  expect(a.brain!.movement?.holdUntil).toBeUndefined();
  expect(a.memories.some((m) => m.content.includes('威胁 bear'))).toBe(true);
  applyEvent(before, e);
  expect(hashWorld(before)).toBe(hashWorld(w));
});
it('low-health policy retreats after damage while fight policy stands and dies', () => {
  for (const mode of ['low_hp', 'fight'] as const) {
    const { w, a, beast } = fixture();
    a.brain!.combatPolicy = { mode, retreatHp: 60 };
    fightBeast(w, new Tx(w), beast, 20);
    if (mode === 'low_hp') {
      expect(a.hp).toBeGreaterThan(0);
      expect(a.hp).toBeLessThanOrEqual(60);
      expect(a.death).toBeUndefined();
    } else expect(a.death?.cause).toContain('野兽');
  }
});
it('trapped agents cannot teleport across water and keep fighting for survival', () => {
  const { w, a, beast } = fixture();
  w.tiles.forEach((t) => {
    if (t.x !== 5 || t.y !== 5) t.eco!.biome = 'water';
  });
  fightBeast(w, new Tx(w), beast, 1);
  expect([a.x, a.y]).toEqual([5, 5]);
  expect(a.hp).toBeLessThan(100);
});
it('model policy is persisted, observed, and applies to attacks by other people', () => {
  const { w, a } = fixture();
  expect(
    BrainOutputSchema.safeParse({ intent: '', combatPolicy: { mode: 'low_hp', retreatHp: 0 } })
      .success,
  ).toBe(false);
  const d = interpret(observeEco(w, a), {
    intent: '谨慎防守',
    combatPolicy: { mode: 'low_hp', retreatHp: 80 },
    speech: { channel: 'public_speak', text: '受伤就撤退' },
  });
  act(w, a.id, d, 'policy');
  endDay(w);
  expect(compactContext(observeEco(w, a)).self.combatPolicy).toEqual({
    mode: 'low_hp',
    retreatHp: 80,
  });
  w.ecology!.beasts = [];
  const b = w.agents[1];
  b.x = a.x;
  b.y = a.y;
  act(w, b.id, { intent: '攻击', action: { type: 'attack', targetId: a.id } }, 'human');
  endDay(w);
  expect(a.hp).toBe(80);
  expect([a.x, a.y]).not.toEqual([b.x, b.y]);
});
