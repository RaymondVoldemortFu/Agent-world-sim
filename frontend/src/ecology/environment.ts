import type { World, Agent } from '../sim/types';
import type { Tx } from '../sim/transaction';
import { ITEMS, RECIPES, BUILDINGS, CROPS } from './catalog';
import { batch, put, mass, spoil, quantity, take, capability } from './batches';
import { climate, ecoAt, initBody } from './world';
import { makeAgent } from '../sim/world';
import { lonelinessCapacity, SOCIAL_RULES } from '../sim/social';
export const absDay = (w: World) => w.config.startDay + w.tick - 1;
export function dieEco(w: World, tx: Tx, a: Agent, cause: string) {
  if (a.death) return;
  tx.a(a);
  a.hp = 0;
  a.ap = 0;
  a.death = { day: w.tick, cause };
  a.corpse = { x: a.x, y: a.y, sinceDay: w.tick };
  delete a.pregnancy;
  const t = tx.t(a.x, a.y, a.eco!.region).eco!;
  put(t.ground, a.eco!.stock);
  a.eco!.stock = [];
  w.counters.deaths++;
  tx.tell(a, `${a.name} #${a.id} 因${cause}死亡，尸体留在原地`, 'observed', undefined, 10);
  for (const b of w.agents)
    if (
      !b.death &&
      b.eco!.region === a.eco!.region &&
      Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= 1
    )
      tx.tell(b, `${a.name} #${a.id} 已死亡；尸体不会回应`, 'observed', undefined, 10);
}
export function finishJobs(w: World, tx: Tx) {
  const eco = w.ecology!;
  for (const job of eco.jobs) {
    if (job.state === 'complete' || job.state === 'cancelled') continue;
    const r = RECIPES[job.recipe];
    if (job.work + 1e-7 < r.minutes || w.tick < job.readyDay) continue;
    const t = tx.t(job.x, job.y, job.region).eco!;
    if (r.tend && w.tick - job.lastTended > r.tend + 1) {
      job.quality = Math.max(0.25, job.quality - 0.1);
      job.lastTended = w.tick;
    }
    const incoming = job.inputs.filter((b) => ITEMS[b.item].kcal > 0);
    const risk = incoming.length ? Math.max(...incoming.map((b) => b.risk)) : 0;
    const q = Math.min(job.quality, ...incoming.map((b) => b.quality));
    let out = 0;
    for (const [id, n] of Object.entries(r.outputs)) {
      const kg = n * (ITEMS[id].kcal ? 1 : job.quality);
      out += kg;
      put(t.ground, [
        batch(
          id,
          kg,
          w.tick,
          `j-${job.id}-${id}`,
          job.id,
          q,
          risk * (id === 'cooked_meat' ? 0.25 : 1),
        ),
      ]);
    }
    const inputMass = mass(job.inputs);
    eco.ledger.outputKg += out;
    eco.ledger.wasteKg += Math.max(0, inputMass - out);
    eco.ledger.burnedKg += job.inputs
      .filter((b) => b.item === 'wood' || b.item === 'charcoal')
      .reduce((n, b) => n + b.kg, 0);
    job.inputs = [];
    job.state = 'complete';
    for (const id of job.operators) {
      const a = w.agents.find((a) => a.id === id);
      if (a && !a.death)
        tx.tell(
          a,
          `${r.name} 工序 ${job.id} 完成，产物位于区域${job.region} (${job.x},${job.y}) 地面`,
        );
    }
    const facility = t.structures.find((b) => b.kind === r.facility);
    if (facility)
      facility.condition = Math.max(0, facility.condition - (r.skill === 'metal' ? 0.04 : 0.005));
  }
}
export function settleEcology(w: World, tx: Tx) {
  const eco = w.ecology!,
    weather = eco.climate;
  for (const t of w.tiles) {
    const e = tx.t(t.x, t.y, t.eco!.region).eco!;
    const used =
        e.fields.reduce((n, f) => n + f.area, 0) +
        e.structures.reduce((n, s) => n + BUILDINGS[s.kind].area, 0),
      habitat = Math.max(0, 1 - used / e.area);
    const rain = weather.rain * e.area * 10000;
    const evaporation = Math.max(0, weather.temperature) * 0.12;
    e.soilWater = Math.max(0, Math.min(e.waterCapacity, e.soilWater + weather.rain - evaporation));
    e.surfaceWater = Math.max(
      0,
      Math.min(
        e.biome === 'water' ? 200000 : 20000,
        e.surfaceWater + rain * 0.2 - evaporation * 100,
      ),
    );
    const wells = e.structures.filter(
      (s) => s.kind === 'well' && s.condition > 0.4 && s.progress >= BUILDINGS.well.minutes,
    ).length;
    e.surfaceWater = Math.min(e.biome === 'water' ? 200000 : 20000, e.surfaceWater + wells * 200);
    e.contamination = Math.max(0.001, e.contamination * 0.96 + (e.herds.length ? 0.005 : 0));
    e.erosion += e.slope * weather.rain * 0.00005 * (1 - habitat);
    e.nitrogen = Math.max(0, e.nitrogen + (e.area * 1.5) / 365 - e.erosion * 0.001);
    e.organic = Math.max(0.1, e.organic + (habitat * 0.002 - 0.001));
    for (const [id, K] of Object.entries(e.capacity)) {
      let n = e.biomass[id] ?? 0;
      const cap = K * habitat;
      if (['nuts', 'grain', 'berries', 'roots'].includes(id)) {
        const d = weather.day;
        const season =
          id === 'nuts'
            ? d >= 244 && d < 305
              ? 61
              : 0
            : id === 'grain'
              ? d >= 210 && d < 250
                ? 40
                : 0
              : id === 'berries'
                ? d >= 152 && d < 244
                  ? 92
                  : 0
                : d >= 60 && d < 335
                  ? 275
                  : 0;
        const growth = season
          ? (K / season) * habitat * Math.min(1, e.soilWater / 60) * weather.drought
          : 0;
        const standingLoss =
          id === 'roots' ? 0.001 : id === 'nuts' ? 0.008 : id === 'grain' ? 0.025 : 0.1;
        n = Math.min(cap, n * (1 - standingLoss) + growth);
      } else if (id === 'fish' || id === 'game') {
        const r = id === 'fish' ? 0.5 : 1;
        n += (r / 365) * n * (1 - n / Math.max(0.01, cap));
      } else if (id === 'green_wood') n += ((cap * 0.02) / 365) * (1 - n / Math.max(0.01, cap));
      else if (id === 'wood') {
        const dead = Math.min(
          e.biomass.green_wood ?? 0,
          ((e.biomass.green_wood ?? 0) * 0.005) / 365,
        );
        e.biomass.green_wood = Math.max(0, (e.biomass.green_wood ?? 0) - dead);
        n = Math.min(cap, n * 0.999 + dead * 0.5);
      } else n = Math.min(cap, n + (cap * (weather.season === 'winter' ? 0.05 : 1)) / 365);
      e.biomass[id] = Math.max(0, n);
    }
    for (const f of e.fields) {
      if (f.stage === 'growing') {
        const c = CROPS[f.crop!];
        const stress = Math.min(1, e.soilWater / 70);
        f.waterStress += 1 - stress;
        f.gdd += Math.max(0, weather.temperature - 5) * stress;
        f.biomass = Math.min(1, f.gdd / c.gdd);
        if (f.gdd >= c.gdd) {
          const fertility = Math.min(1, e.nitrogen / (e.area * 120));
          f.harvestKg =
            c.yield *
            f.area *
            0.92 *
            fertility *
            Math.max(0.3, 1 - f.waterStress / 100) *
            Math.min(1, 0.65 + (f.work / (75 * f.area * 120)) * 0.35);
          f.stage = 'ripe';
        } else if (w.tick - (f.planted ?? w.tick) > 300) {
          f.stage = 'fallow';
          f.harvestKg = 0;
        }
      } else if (f.stage === 'ripe') f.harvestKg *= 0.995;
      else if (f.stage === 'fallow') e.nitrogen += (f.area * 8) / 365;
    }
    eco.ledger.spoiledKg += spoil(e.ground, weather.temperature);
    for (const s of e.structures) {
      s.condition = Math.max(0, s.condition - BUILDINGS[s.kind].decay * (1 + weather.rain * 0.02));
      eco.ledger.spoiledKg += spoil(
        s.contents,
        weather.temperature,
        s.condition > 0.4 && s.progress >= BUILDINGS[s.kind].minutes,
      );
    }
    for (const h of e.herds) {
      const unit = h.species === 'cattle' ? 8 : 1.2,
        need = h.count * unit;
      let fed = 0;
      for (const item of ['hay', 'straw']) {
        const stock = [e.ground, ...e.structures.map((s) => s.contents)];
        for (const store of stock) {
          const n = Math.min(need - fed, quantity(store, item));
          if (n > 0) {
            take(store, item, n);
            fed += n;
          }
        }
      }
      if (weather.season !== 'winter') {
        const n = Math.min(need - fed, e.biomass.hay ?? 0);
        e.biomass.hay = (e.biomass.hay ?? 0) - n;
        fed += n;
      }
      const water = Math.min(e.surfaceWater, h.count * (h.species === 'cattle' ? 30 : 4));
      e.surfaceWater -= water;
      h.hunger = Math.max(0, Math.min(100, h.hunger + (1 - fed / Math.max(1, need)) * 20 - 5));
      h.health = Math.max(0, Math.min(100, h.health + (fed >= need && water > 0 ? 1 : -3)));
      if (fed > 0)
        put(e.ground, [
          batch('manure', fed * 0.35, w.tick, `manure-${w.tick}-${h.id}`, '饲料转化'),
        ]);
      if (h.health === 0 && h.count > 0) {
        h.count--;
        h.females = Math.min(h.females, h.count);
        h.health = 40;
      }
      if (h.count >= 2 && h.health > 70 && h.hunger < 20 && h.females < h.count)
        h.offspringProgress += h.females / 150;
      if (h.offspringProgress >= 1) {
        const born = Math.floor(h.offspringProgress);
        h.count += born;
        h.females += Math.floor(born / 2);
        h.offspringProgress -= born;
      }
    }
    for (const k of Object.keys(e.improvements))
      e.improvements[k] = Math.max(0, e.improvements[k] - 0.001);
  }
  finishJobs(w, tx);
  for (const a of w.agents.filter((a) => !a.death)) {
    tx.a(a);
    const body = a.eco!,
      t = ecoAt(w, a.x, a.y, body.region).eco!;
    eco.ledger.spoiledKg += spoil(body.stock, weather.temperature);
    const adult = a.age >= w.config.adultAge;
    const demand =
      (adult ? 2500 : 1500) * (a.pregnancy ? 1.15 : 1) + Math.max(0, 5 - weather.temperature) * 15;
    body.foodKcal = Math.max(0, body.foodKcal - demand);
    body.waterL = Math.max(0, body.waterL - (adult ? 2.5 : 1.5));
    a.hunger = Math.min(100, body.foodKcal / 50);
    const shelters = t.structures.filter(
      (s) => s.condition > 0.4 && s.progress >= BUILDINGS[s.kind].minutes,
    );
    const room = shelters.reduce((n, s) => n + BUILDINGS[s.kind].shelter, 0);
    const occupants = w.agents
      .filter((b) => !b.death && b.eco!.region === body.region && b.x === a.x && b.y === a.y)
      .sort((a, b) => a.id - b.id);
    const covered = occupants.findIndex((b) => b.id === a.id) < room;
    const warm = capability([body.stock], 'warmth');
    body.cold = Math.max(0, 5 - weather.temperature - (covered ? 8 : 0) - warm * 8);
    body.sickness = Math.max(0, body.sickness - 0.8);
    const injury =
      (body.foodKcal <= 0 ? 15 : 0) + (body.waterL <= 0 ? 12 : 0) + body.cold * 0.7 + body.sickness;
    a.hp = Math.min(100, a.hp + (injury === 0 && a.hunger > 30 ? 3 : 0) - injury);
    if (a.social) {
      if (w.tick - a.social.lastSpokeDay >= 2)
        a.social.loneliness = Math.min(lonelinessCapacity(a), a.social.loneliness + 20);
      if (a.social.loneliness >= lonelinessCapacity(a)) a.social.depressed = true;
      if (a.social.depressed) a.hp -= SOCIAL_RULES.depressionDamagePerDay;
    }
    if (a.hp <= 0) {
      dieEco(
        w,
        tx,
        a,
        body.foodKcal <= 0
          ? '饥饿'
          : body.waterL <= 0
            ? '脱水'
            : body.cold > 0
              ? '寒冷'
              : body.sickness > 0
                ? '感染'
                : '抑郁',
      );
      continue;
    }
    a.age++;
    body.readyAt = 0;
    a.ap = w.config.dailyAP;
    a.brain!.callsDay = 0;
    a.brain!.tokensDay = 0;
    if (
      a.pregnancy &&
      a.pregnancy.due <= w.tick &&
      w.agents.filter((a) => !a.death).length < w.config.populationLimit
    ) {
      const child = makeAgent(w, a.x, a.y, [a.id, a.pregnancy.father]);
      initBody(w, child, true);
      child.eco!.region = body.region;
      child.ap = w.config.dailyAP;
      w.agents.push(child);
      tx.a(child);
      delete a.pregnancy;
      a.cooldownUntil = w.tick + 180;
      w.counters.births++;
      eco.ledger.births++;
      tx.tell(a, `生下 ${child.name} #${child.id}`, 'observed', undefined, 10);
    }
  }
  eco.clock = 0;
  eco.climate = climate(absDay(w) + 1, w.config.seed);
}
