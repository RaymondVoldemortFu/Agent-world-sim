/** Deterministic annual diagnostics. Perfect daily capture is a potential upper bound, not an Agent outcome. */
import fs from 'node:fs';
import { createWorld } from '../frontend/src/sim/world';
import { settleEcology } from '../frontend/src/ecology/environment';
import { Tx } from '../frontend/src/sim/transaction';
import { ITEMS } from '../frontend/src/ecology/catalog';
import { validateEcology } from '../frontend/src/ecology/invariants';
const seeds = [20260909, 20260910, 20260911];
const results = [];
for (const seed of seeds) {
  const w = createWorld(
    { worldModel: 'ecology', size: 15, regions: 1, population: 1, days: 365, seed, startDay: 1 },
    'annual-diagnostic',
  );
  w.agents = [];
  let captured = 0;
  const seasons: Record<string, number> = {};
  const deposits = w.tiles.reduce((n, t) => n + t.eco!.deposits.reduce((n, d) => n + d.kg, 0), 0);
  const fieldTile = w.tiles.find((t) => t.eco!.biome === 'floodplain')!;
  let harvested = 0;
  for (let day = 1; day <= 365; day++) {
    w.tick = day;
    const season = w.ecology!.climate.season;
    if (day === 90)
      fieldTile.eco!.fields.push({
        id: 'diagnostic-field',
        area: 0.25,
        crop: 'grain',
        planted: day,
        gdd: 0,
        work: 2250,
        harvestWork: 0,
        biomass: 0,
        waterStress: 0,
        fertility: 1,
        harvestKg: 0,
        stage: 'growing',
      });
    // Record available wild edible plants before daily ecosystem update, simulating perfect collection with unlimited labor.
    for (const t of w.tiles)
      for (const [id, n] of Object.entries(t.eco!.biomass))
        if (['nuts', 'roots', 'berries', 'grain'].includes(id)) {
          const fd = (n * ITEMS[id].kcal) / 2500;
          captured += fd;
          seasons[season] = (seasons[season] ?? 0) + fd;
          t.eco!.biomass[id] = 0;
        }
    settleEcology(w, new Tx(w));
    const f = fieldTile.eco!.fields[0];
    if (f?.stage === 'ripe') {
      harvested = f.harvestKg;
      f.harvestKg = 0;
      f.stage = 'fallow';
    }
    validateEcology(w);
  }
  const after = w.tiles.reduce((n, t) => n + t.eco!.deposits.reduce((n, d) => n + d.kg, 0), 0);
  if (deposits !== after) throw Error('unmined geology changed');
  results.push({
    seed,
    perfectPlantCaptureFD: captured,
    bySeason: seasons,
    wellTendedQuarterHaGrainKg: harvested,
    geologyUnchanged: true,
  });
}
const result = {
  description:
    '365-day ecology diagnostics: perfect plant capture includes initial standing stock; planted field assumes real seeds and completed labor supplied by a fixture, not a behavioral outcome.',
  results,
};
fs.mkdirSync('artifacts/eco-diagnostics', { recursive: true });
fs.writeFileSync('artifacts/eco-diagnostics/annual.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
