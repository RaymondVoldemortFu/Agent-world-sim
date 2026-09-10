import { strikeWall } from './fortifications';
import { shouldFlee, fleeProbability } from './combat-policy';
import type { Agent, World } from '../sim/types';
import type { Beast, Settlement, Batch } from './types';
import type { Tx } from '../sim/transaction';
import { rand } from '../sim/world';
import { ITEMS, BUILDINGS } from './catalog';
import { batch, put, take, quantity } from './batches';
import { ecoAt } from './world';
import { dieEco } from './environment';

export const WILDLIFE_RULES = {
  settlementRadius: 1,
  population: 5,
  infrastructure: 3,
  spawnMin: 3,
  spawnMax: 5,
  maxPerRegion: 3,
  spawnEveryDays: 5,
  minHp: 180,
  hpSpread: 80,
  minAttack: 24,
  attackSpread: 12,
  bareHands: 6,
  dailyRounds: 3,
  regeneration: 12,
} as const;
export const BEAST_NAMES = { bear: '熊', boar: '巨型野猪', wolf_pack: '狼群' };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function settlements(w: World): Settlement[] {
  const cells = new Map<string, Settlement>();
  const cell = (region: number, x: number, y: number) => {
    const key = `${region}:${x}:${y}`;
    if (!cells.has(key)) cells.set(key, { region, x, y, population: 0, infrastructure: 0 });
    return cells.get(key)!;
  };
  for (const a of w.agents) if (!a.death && a.eco) cell(a.eco.region, a.x, a.y).population++;
  for (const t of w.tiles) {
    const e = t.eco;
    if (!e) continue;
    const n =
      e.structures.filter(
        (s) => s.condition > 0.2 && s.progress >= (BUILDINGS[s.kind]?.minutes ?? Infinity),
      ).length + e.fields.filter((f) => f.area > 0 && f.stage !== 'clearing').length;
    if (n) cell(e.region, t.x, t.y).infrastructure = n;
  }
  const candidates = [...cells.values()]
    .map((c) => {
      const near = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
        cells.get(`${c.region}:${c.x + (i % 3) - 1}:${c.y + Math.floor(i / 3) - 1}`),
      );
      return {
        ...c,
        population: near.reduce((n, p) => n + (p?.population ?? 0), 0),
        infrastructure: near.reduce((n, p) => n + (p?.infrastructure ?? 0), 0),
      };
    })
    .filter(
      (c) =>
        c.population >= WILDLIFE_RULES.population ||
        c.infrastructure >= WILDLIFE_RULES.infrastructure,
    )
    .sort(
      (a, b) =>
        b.population - a.population ||
        b.infrastructure - a.infrastructure ||
        a.region - b.region ||
        a.y - b.y ||
        a.x - b.x,
    );
  const result: Settlement[] = [];
  for (const c of candidates)
    if (!result.some((s) => s.region === c.region && distance(s, c) <= 2)) result.push(c);
  return result;
}

export function combatEquipment(a: Pick<Agent, 'eco'>) {
  const eligible = (a.eco?.stock ?? []).filter(
    (b) =>
      b.kg + 1e-7 >= (ITEMS[b.item]?.unitKg ?? Infinity) &&
      (b.wear ?? 0) < (ITEMS[b.item]?.durability ?? 0),
  );
  const best = (key: 'attack' | 'armor' | 'shield') =>
    [...eligible]
      .sort((a, b) => (ITEMS[b.item]?.combat?.[key] ?? 0) - (ITEMS[a.item]?.combat?.[key] ?? 0))
      .find((b) => (ITEMS[b.item]?.combat?.[key] ?? 0) > 0);
  const weapon = best('attack'),
    armor = best('armor');
  // Bows require both hands; shields are usable with melee weapons.
  const shield = weapon?.item === 'bow' ? undefined : best('shield');
  return {
    attack: Math.max(WILDLIFE_RULES.bareHands, ITEMS[weapon?.item ?? '']?.combat?.attack ?? 0),
    protection:
      1 -
      (1 - (ITEMS[armor?.item ?? '']?.combat?.armor ?? 0)) *
        (1 - (ITEMS[shield?.item ?? '']?.combat?.shield ?? 0)),
    weapon: weapon?.item ?? 'bare_hands',
    armor: armor?.item ?? 'none',
    shield: shield?.item ?? 'none',
    batches: [weapon, armor, shield].filter((b): b is Batch => !!b),
  };
}
export function combatView(a: Pick<Agent, 'eco'>) {
  const { batches, ...view } = combatEquipment(a);
  return view;
}

function spawn(w: World, region: number, mode: Beast['mode'], towns: Settlement[]) {
  const beasts = w.ecology!.beasts!;
  if (beasts.filter((b) => b.region === region && b.hp > 0).length >= WILDLIFE_RULES.maxPerRegion)
    return;
  if (
    beasts.some(
      (b) =>
        b.region === region &&
        b.deathDay !== undefined &&
        w.tick < b.deathDay + (w.config.beastRespawnDays ?? 10),
    )
  )
    return;
  const local = towns.filter((s) => s.region === region);
  const residents = w.agents.filter((a) => !a.death && a.eco!.region === region);
  const available = w.tiles.filter(
    (t) =>
      t.eco!.region === region &&
      t.eco!.biome !== 'water' &&
      !t.eco!.structures.length &&
      !t.eco!.fields.length &&
      residents.every((a) => distance(a, t) >= WILDLIFE_RULES.spawnMin) &&
      !beasts.some((b) => b.region === region && b.hp > 0 && distance(b, t) < 2) &&
      local.every((s) => distance(s, t) >= WILDLIFE_RULES.spawnMin) &&
      (mode === 'roaming' || local.some((s) => distance(s, t) <= WILDLIFE_RULES.spawnMax)),
  );
  if (!available.length) return;
  const t = available[Math.floor(rand(w) * available.length)];
  const multiplier = w.config.beastPowerMultiplier ?? 1;
  const hp = Math.max(
    1,
    Math.round(
      (WILDLIFE_RULES.minHp + Math.floor(rand(w) * (WILDLIFE_RULES.hpSpread + 1))) * multiplier,
    ),
  );
  const beast: Beast = {
    id: `beast-${w.ecology!.nextId++}`,
    species: (['bear', 'boar', 'wolf_pack'] as const)[Math.floor(rand(w) * 3)],
    region,
    x: t.x,
    y: t.y,
    hp,
    maxHp: hp,
    attack: Math.max(
      1,
      Math.round(
        (WILDLIFE_RULES.minAttack + Math.floor(rand(w) * (WILDLIFE_RULES.attackSpread + 1))) *
          multiplier,
      ),
    ),
    born: w.tick,
    mode,
  };
  beasts.push(beast);
}
export function initWildlife(w: World) {
  if (w.config.wildlifeEnabled === false || w.ecology!.beasts) return;
  w.ecology!.beasts = [];
  const towns = settlements(w);
  for (let region = 0; region < w.config.regions; region++) {
    if (towns.some((s) => s.region === region)) spawn(w, region, 'raiding', towns);
    spawn(w, region, 'roaming', towns);
  }
}

function notice(w: World, tx: Tx, beast: Beast, text: string) {
  for (const a of w.agents)
    if (!a.death && a.eco!.region === beast.region && distance(a, beast) <= 1)
      tx.tell(a, text, 'observed', undefined, 9);
}
export function fightBeast(w: World, tx: Tx, beast: Beast, rounds = 1) {
  const lines: string[] = [];
  for (let round = 0; round < rounds && beast.hp > 0; round++) {
    const attempts = new Set<number>();
    for (const a of w.agents.filter(
      (a) => !a.death && a.eco!.region === beast.region && distance(a, beast) <= 1,
    )) {
      const retreat = fleeCombat(w, tx, a, beast, attempts);
      if (retreat) lines.push(retreat.text);
    }
    const nearby = w.agents.filter(
      (a) => !a.death && a.eco!.region === beast.region && distance(a, beast) <= 1,
    );
    if (!nearby.length) break;
    const fighters = nearby.filter((a) => a.age >= w.config.adultAge);
    let damage = 0;
    for (const a of fighters) {
      tx.a(a);
      const gear = combatEquipment(a);
      damage += gear.attack;
      for (const b of gear.batches) b.wear = (b.wear ?? 0) + 120;
    }
    // Both sides strike in a round, so a final blow cannot suppress retaliation.
    const victim = [...nearby].sort(
      (a, b) => distance(a, beast) - distance(b, beast) || a.hp - b.hp || a.id - b.id,
    )[0];
    tx.a(victim);
    const rawDamage = Math.ceil(beast.attack * (0.9 + rand(w) * 0.2));
    const wall = strikeWall(w, tx, victim.eco!.region, victim.x, victim.y, rawDamage);
    const injury = Math.ceil(wall.remaining * (1 - combatEquipment(victim).protection));
    beast.hp = Math.max(0, beast.hp - damage);
    victim.hp = Math.max(0, victim.hp - injury);
    const text = `${BEAST_NAMES[beast.species]} ${beast.id} 与 ${fighters.map((a) => `#${a.id}`).join('、') || '无人防守的居民'} 交战：野兽受伤${damage}，${victim.name} #${victim.id} 受伤${injury}，野兽生命${beast.hp}/${beast.maxHp}`;
    if (wall.message) {
      notice(w, tx, beast, wall.message);
      lines.push(wall.message);
    }
    notice(w, tx, beast, text);
    lines.push(text);
    if (victim.hp <= 0) dieEco(w, tx, victim, `野兽袭击（${BEAST_NAMES[beast.species]}）`);
    else if (beast.hp > 0) {
      const retreat = fleeCombat(w, tx, victim, beast, attempts);
      if (retreat) lines.push(retreat.text);
    }
    if (beast.hp <= 0) {
      beast.deathDay = w.tick;
      const t = tx.t(beast.x, beast.y, beast.region).eco!;
      for (const [item, kg] of Object.entries({ meat: 12, hide: 4, bone: 3, fat: 1 }))
        put(t.ground, [batch(item, kg, w.tick, `${beast.id}-${item}`, '击败野兽')]);
      const message = `${BEAST_NAMES[beast.species]} ${beast.id} 被击败，肉、皮、骨和脂留在地上`;
      notice(w, tx, beast, message);
      lines.push(message);
    }
  }
  return lines;
}

/** Emergency reaction between combat rounds, including night attacks when daily AP is exhausted. */
export function fleeCombat(
  w: World,
  tx: Tx,
  a: Agent,
  threat: { x: number; y: number; region: number; id: string | number },
  attempts = new Set<number>(),
) {
  if (!shouldFlee(a.hp, a.brain) || attempts.has(a.id)) return;
  attempts.add(a.id);
  const hazards = [
    threat,
    ...(w.ecology!.beasts ?? []).filter((b) => b.hp > 0 && b.region === threat.region),
  ];
  const safety = (p: { x: number; y: number }) => Math.min(...hazards.map((b) => distance(p, b)));
  const queue = [{ x: a.x, y: a.y, steps: 0 }],
    seen = new Set([`${a.x},${a.y}`]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.steps >= 2) continue;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const x = p.x + dx,
        y = p.y + dy,
        key = `${x},${y}`;
      if (
        x < 0 ||
        y < 0 ||
        x >= w.config.size ||
        y >= w.config.size ||
        seen.has(key) ||
        ecoAt(w, x, y, threat.region).eco!.biome === 'water' ||
        hazards.some((b) => b.x === x && b.y === y)
      )
        continue;
      seen.add(key);
      queue.push({ x, y, steps: p.steps + 1 });
    }
  }
  const destination = queue
    .filter((p) => p.steps && safety(p) > 1)
    .sort((a, b) => a.steps - b.steps || safety(b) - safety(a))[0];
  const chance = fleeProbability(a.hp);
  const failed = !destination
    ? '两步内没有安全陆路'
    : rand(w) >= chance
      ? `生命${a.hp}，本次成功率${Math.round(chance * 100)}%`
      : '';
  if (failed) {
    const text = `${a.name} #${a.id} 撤退失败（${failed}），仍在威胁 ${threat.id} 附近`;
    tx.tell(a, text, 'observed', undefined, 9);
    return { escaped: false, text };
  }
  if (!destination) return;
  tx.a(a);
  const text = `${a.name} #${a.id} 遇到威胁 ${threat.id}，按战斗策略从(${a.x},${a.y})撤退至(${destination.x},${destination.y})，生命${a.hp}；脱离战斗`;
  const witnesses = w.agents.filter(
    (b) => !b.death && b.eco!.region === threat.region && distance(a, b) <= 1,
  );
  a.x = destination.x;
  a.y = destination.y;
  // Abandon interrupted work rather than completing it at an unrelated destination.
  w.ecology!.pending = w.ecology!.pending.filter((p) => p.actor !== a.id);
  a.eco!.readyAt = w.ecology!.clock;
  if (a.brain!.goal?.skill !== 'navigate') delete a.brain!.goal;
  delete a.brain!.navigation;
  delete a.brain!.procurement;
  delete a.brain!.forageTrip;
  delete a.brain!.gatherOrigin;
  if (a.brain!.movement) delete a.brain!.movement.holdUntil;
  for (const b of new Set([a, ...witnesses])) tx.tell(b, text, 'observed', undefined, 9);
  return { escaped: true, text: `${text}（成功率${Math.round(chance * 100)}%）` };
}

function stepToward(w: World, beast: Beast, target: { x: number; y: number }) {
  // Find a dry path; never teleport through a river or move twice in one day.
  const size = w.config.size,
    origin = beast.y * size + beast.x;
  const queue = [origin],
    seen = new Set(queue),
    first = new Map<number, number>();
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i],
      x = key % size,
      y = Math.floor(key / size);
    if (distance({ x, y }, target) <= 1) {
      const next = first.get(key);
      if (next !== undefined) {
        beast.x = next % size;
        beast.y = Math.floor(next / size);
      }
      return;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        n = ny * size + nx;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= size ||
        ny >= size ||
        seen.has(n) ||
        ecoAt(w, nx, ny, beast.region).eco!.biome === 'water'
      )
        continue;
      seen.add(n);
      first.set(n, first.get(key) ?? n);
      queue.push(n);
    }
  }
}
export function advanceWildlife(w: World, tx: Tx): string[] {
  initWildlife(w);
  const eco = w.ecology!;
  eco.wildlifeDay = w.tick;
  const towns = settlements(w),
    lines: string[] = [];
  for (const beast of eco.beasts ?? []) {
    if (beast.hp <= 0 || beast.born >= w.tick) continue;
    beast.hp = Math.min(
      beast.maxHp,
      beast.hp + WILDLIFE_RULES.regeneration * (w.config.beastPowerMultiplier ?? 1),
    );
    const residents = w.agents.filter(
      (a) => !a.death && a.eco!.region === beast.region && distance(a, beast) <= 3,
    );
    const local = towns.filter((s) => s.region === beast.region);
    const target = [...residents, ...(beast.mode === 'raiding' ? local : [])].sort(
      (a, b) => distance(a, beast) - distance(b, beast),
    )[0];
    if (target) {
      const before = `${beast.x},${beast.y}`;
      stepToward(w, beast, target);
      if (before !== `${beast.x},${beast.y}`) {
        const message = `${BEAST_NAMES[beast.species]} ${beast.id} 逼近至区域${beast.region} (${beast.x},${beast.y})`;
        notice(w, tx, beast, message);
        lines.push(message);
      }
    } else {
      const options = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
        .map(([dx, dy]) => ({ x: beast.x + dx, y: beast.y + dy }))
        .filter(
          (p) =>
            p.x >= 0 &&
            p.y >= 0 &&
            p.x < w.config.size &&
            p.y < w.config.size &&
            ecoAt(w, p.x, p.y, beast.region).eco!.biome !== 'water',
        );
      if (options.length) Object.assign(beast, options[Math.floor(rand(w) * options.length)]);
    }
    lines.push(...fightBeast(w, tx, beast, WILDLIFE_RULES.dailyRounds));
    if (beast.hp > 0) {
      const town = local.find((s) => distance(s, beast) <= 1);
      if (town) {
        const wall = strikeWall(w, tx, town.region, town.x, town.y, beast.attack);
        if (wall.message) {
          notice(w, tx, beast, wall.message);
          lines.push(wall.message);
        }
        if (wall.remaining <= 0) continue;
        const t = tx.t(town.x, town.y, town.region).eco!;
        for (const s of t.structures) s.condition = Math.max(0, s.condition - 0.08);
        for (const f of t.fields) {
          f.biomass *= 0.8;
          f.harvestKg *= 0.8;
        }
        for (const stock of [t.ground, ...t.structures.map((s) => s.contents)])
          for (const item of ['meat', 'fish', 'grain', 'nuts']) {
            const kg = Math.min(2, quantity(stock, item));
            if (kg > 0) take(stock, item, kg);
          }
        if (t.herds[0]?.count) {
          t.herds[0].count--;
          t.herds[0].females = Math.min(t.herds[0].females, t.herds[0].count);
        }
        const text = `${BEAST_NAMES[beast.species]} ${beast.id} 侵扰聚居地 (${town.x},${town.y})，损坏设施并觅食`;
        notice(w, tx, beast, text);
        lines.push(text);
      }
    }
  }
  eco.beasts = (eco.beasts ?? []).filter(
    (b) =>
      b.deathDay === undefined ||
      w.tick - b.deathDay <= Math.max(30, w.config.beastRespawnDays ?? 10),
  );
  if (w.tick % WILDLIFE_RULES.spawnEveryDays === 0)
    for (let region = 0; region < w.config.regions; region++) {
      const before = eco.beasts.length;
      spawn(w, region, towns.some((s) => s.region === region) ? 'raiding' : 'roaming', towns);
      if (eco.beasts.length > before) lines.push(`区域${region} 出现新的野兽踪迹`);
    }
  return lines;
}
