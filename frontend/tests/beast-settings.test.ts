import { it, expect } from 'vitest';
import { createWorld } from '../src/sim/world';
import { ConfigSchema } from '../src/sim/types';
import { Tx } from '../src/sim/transaction';
import { advanceWildlife } from '../src/ecology/wildlife';

it('scales initial beast health and attack with the same seeded random draws', () => {
  const base = {
    worldModel: 'ecology' as const,
    population: 1,
    regions: 1,
    seed: 42,
    wildlifeEnabled: true,
  };
  const strong = createWorld({ ...base, beastPowerMultiplier: 1 }, 'scale');
  const weak = createWorld({ ...base, beastPowerMultiplier: 0.5 }, 'scale');
  expect(strong.ecology!.beasts!.length).toBeGreaterThan(0);
  strong.ecology!.beasts!.forEach((b, i) => {
    const v = weak.ecology!.beasts![i];
    expect(v.maxHp).toBe(Math.round(b.maxHp / 2));
    expect(v.attack).toBe(Math.round(b.attack / 2));
    expect(v.hp).toBe(v.maxHp);
  });
  expect(ConfigSchema.safeParse({ ...base, beastPowerMultiplier: 0 }).success).toBe(false);
  expect(ConfigSchema.safeParse({ ...base, beastRespawnDays: -1 }).success).toBe(false);
});
it.each([10, 60])(
  'blocks regional replacements for %i days, including beyond corpse retention',
  (days) => {
    const w = createWorld(
      {
        worldModel: 'ecology',
        population: 1,
        regions: 1,
        wildlifeEnabled: true,
        beastRespawnDays: days,
      },
      'cooldown',
    );
    const b = w.ecology!.beasts![0];
    expect(b).toBeDefined();
    b.hp = 0;
    b.deathDay = 1;
    w.ecology!.beasts = [b];
    for (let day = 5; day <= days; day += 5) {
      w.tick = day;
      advanceWildlife(w, new Tx(w));
      expect(w.ecology!.beasts!.filter((b) => b.hp > 0)).toHaveLength(0);
    }
    w.tick = days + 5;
    advanceWildlife(w, new Tx(w));
    expect(w.ecology!.beasts!.filter((b) => b.hp > 0).length).toBeGreaterThan(0);
  },
);
