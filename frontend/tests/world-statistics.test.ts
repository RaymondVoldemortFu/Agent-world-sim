import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/sim/world';
import { worldStatistics } from '../src/ui/world-statistics';
import { batch } from '../src/ecology/batches';
import { ITEMS } from '../src/ecology/catalog';
import type { Job } from '../src/ecology/types';
describe('world statistics accounting', () => {
  it('separates stocks, excludes dead inventories and processing calories, handles extinction', () => {
    const w = createWorld({ worldModel: 'ecology', population: 2 }, 'stats');
    for (const t of w.tiles) {
      t.eco!.biomass = {};
      t.eco!.deposits = [];
      t.eco!.ground = [];
      t.eco!.structures = [];
    }
    const nuts = (kg: number) => [batch('nuts', kg, 1, `n${kg}`, 'test')];
    w.agents[0].eco!.stock = nuts(1);
    w.agents[1].eco!.stock = nuts(100);
    w.agents[0].hp = 80;
    w.agents[1].death = { day: 1, cause: 'test' };
    w.tiles[0].eco!.ground = nuts(2);
    w.tiles[0].eco!.biomass = { nuts: 5 };
    w.tiles[0].eco!.structures = [
      { id: 'test', kind: 'shelter', progress: 0, condition: 1, contents: nuts(3) },
    ];
    w.ecology!.jobs = [{ inputs: nuts(4) } as Job];
    const s = worldStatistics(w);
    const row = s.resources.find((r) => r.id === 'nuts')!;
    expect(row).toMatchObject({ bag: 1, ground: 2, stored: 3, processing: 4, natural: 5 });
    expect(s.current.food).toBeCloseTo((6 * ITEMS.nuts.kcal) / 2500);
    expect(s.averageHP).toBe(80);
    w.agents[0].death = { day: 1, cause: 'test' };
    expect(worldStatistics(w).averageHP).toBeNull();
  });
});
