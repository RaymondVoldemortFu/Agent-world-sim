import type { World } from '../sim/types';
import { ITEMS, BUILDINGS, RECIPES } from './catalog';
import { mass, capacity } from './batches';
import type { Batch } from './types';
export function validateEcology(w: World) {
  if (!w.ecology) return;
  const check = (ok: boolean, message: string) => {
    if (!ok) throw Error(`Ecology invariant: ${message}`);
  };
  const stock = (b: Batch[]) => {
    for (const x of b) {
      check(!!ITEMS[x.item], `unknown item ${x.item}`);
      check(Number.isFinite(x.kg) && x.kg > 0, 'positive finite mass');
      check(x.quality >= 0 && x.quality <= 1 && x.risk >= 0 && x.risk <= 1, 'quality/risk range');
    }
  };
  for (const a of w.agents) {
    check(!!a.eco && !!a.brain, 'agent state');
    stock(a.eco!.stock);
    check(
      mass(a.eco!.stock) <= capacity(a.eco!.stock, w.config.inventoryCapacity) + 1e-6,
      'bag capacity',
    );
    check(a.ap >= -1e-7 && a.ap <= w.config.dailyAP + 1e-7, 'action time');
    check(a.eco!.region >= 0 && a.eco!.region < w.config.regions, 'region');
    check(a.eco!.foodKcal >= 0 && a.eco!.waterL >= 0, 'body stores');
    check(a.brain!.callsDay <= 3, 'hard model quota');
  }
  check(w.tiles.length === w.config.regions * w.config.size ** 2, 'region tile count');
  for (const t of w.tiles) {
    const e = t.eco!;
    stock(e.ground);
    check(
      e.fields.reduce((n, f) => n + f.area, 0) +
        e.structures.reduce((n, s) => n + BUILDINGS[s.kind].area, 0) <=
        e.area + 1e-7,
      'land area',
    );
    check(
      Object.values(e.biomass).every((n) => Number.isFinite(n) && n >= -1e-7),
      'biomass',
    );
    check(
      e.deposits.every((d) => d.kg >= 0),
      'finite deposits',
    );
    check(e.nitrogen >= 0 && e.soilWater >= 0 && e.surfaceWater >= 0, 'soil and water');
    for (const s of e.structures) {
      stock(s.contents);
      check(s.condition >= 0 && s.condition <= 1, 'building condition');
      check(mass(s.contents) <= BUILDINGS[s.kind].storage + 1e-7, 'storage capacity');
    }
  }
  const actors = new Set<number>();
  for (const p of w.ecology.pending) {
    check(!actors.has(p.actor), 'one pending action per actor');
    actors.add(p.actor);
    check(p.at >= w.ecology.clock, 'pending event time');
  }
  for (const j of w.ecology.jobs) {
    stock(j.inputs);
    check(!!RECIPES[j.recipe], 'recipe');
    check(j.work >= 0 && j.work <= RECIPES[j.recipe].minutes + 1e-6, 'job progress');
    if (['complete', 'cancelled'].includes(j.state))
      check(j.inputs.length === 0, 'no spent inputs');
  }
  for (const n of Object.values(w.ecology.ledger))
    check(Number.isFinite(n) && n >= -1e-6, 'ledger');
}
