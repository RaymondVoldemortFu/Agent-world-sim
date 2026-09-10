import { initWildlife } from './wildlife';
import { initVillage } from './village';
import type { World, Agent, Tile } from '../sim/types';
import { ITEMS, RECIPES, STARTER_KNOWLEDGE, BUILDINGS } from './catalog';
import { batch } from './batches';
import type { Biome, Climate, EcoTile } from './types';
export function climate(day: number, seed: number): Climate {
  const d = ((day - 1) % 365) + 1,
    year = Math.floor((day - 1) / 365) + 1;
  const seasonal = Math.sin((2 * Math.PI * (d - 80)) / 365);
  const noise = Math.sin((day + seed) * 12.9898) * 43758.5453;
  const r = noise - Math.floor(noise);
  const drought = Math.sin((year + seed) * 1.23) > 0.82 ? 0.55 : 1;
  return {
    day: d,
    year,
    season: d < 60 || d >= 335 ? 'winter' : d < 152 ? 'spring' : d < 244 ? 'summer' : 'autumn',
    temperature: 11 + 12 * seasonal + (r - 0.5) * 6,
    rain: (r > 0.7 ? 12 : 1) * drought,
    daylight: 12 + 4 * seasonal,
    drought,
  };
}
export const ecoAt = (w: World, x: number, y: number, region = 0) =>
  w.tiles[region * w.config.size * w.config.size + y * w.config.size + x];
export function initBody(w: World, a: Agent, child = false) {
  a.inventory = {};
  a.foodBatches = [];
  a.age = child ? 0 : 22 * 365 + ((a.id * 37) % 4000);
  a.eco = {
    region: 0,
    readyAt: 0,
    foodKcal: child ? 2000 : 5000,
    waterL: 4,
    cold: 0,
    sickness: 0,
    protein: 1,
    stock: child ? [] : [batch('nuts', 1.5, w.tick, `initial-${a.id}`, '初始口粮')],
    skills: {},
    knowledge:
      a.role === 'prophet'
        ? [...Object.keys(RECIPES), ...Object.keys(BUILDINGS).map((k) => 'build:' + k), 'farming']
        : STARTER_KNOWLEDGE.slice(),
  };
  a.brain = {
    version: 'brain-1',
    lastThought: -10,
    lastTalk: 0,
    callsDay: 0,
    calls: 0,
    handled: [],
    places: [],
    failures: 0,
    source: 'rule',
    lastReflection: 0,
  };
}
export function initEcology(w: World) {
  const size = w.config.size;
  if (w.config.ecoPreset === 'village') w.config.spawn = 'compact';
  w.config.gestation = 280;
  w.config.adultAge = 16 * 365;
  w.ecology = {
    version: 'eco-1',
    clock: 0,
    nextId: 1,
    climate: climate(w.config.startDay, w.config.seed),
    jobs: [],
    pending: [],
    regionNames: ['河谷', '铜山', '锡岭'].slice(0, w.config.regions),
    ledger: {
      gatheredKg: 0,
      consumedKcal: 0,
      spoiledKg: 0,
      burnedKg: 0,
      outputKg: 0,
      wasteKg: 0,
      harvestedKg: 0,
      births: 0,
    },
    brainStats: { ruleActions: 0, planActions: 0, llmDecisions: 0, fallbacks: 0 },
  };
  const biomes: Biome[] = ['forest', 'meadow', 'wetland', 'floodplain', 'hill', 'water'];
  const proportions = [96, 48, 20, 24, 24, 13];
  const totals: Partial<Record<Biome, Record<string, number>>> = {
    forest: { nuts: 900, berries: 2550, roots: 1275 },
    meadow: { grain: 800, roots: 1030 },
    wetland: { roots: 3750 },
    floodplain: { roots: 1500, grain: 441.176470588 },
    hill: { nuts: 136.363636364 },
  };
  const tiles: Tile[] = [];
  for (let region = 0; region < w.config.regions; region++) {
    const count = Array(6).fill(0);
    const regionTiles: Tile[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        // A deterministic mosaic with a connected river, rather than population-adaptive food.
        let idx =
          y === Math.floor(size / 2) && x < size - 2
            ? 5
            : Math.floor((((x * 13 + y * 7 + region * 11) % 29) / 29) * 5);
        const target = (x * 37 + y * 61 + region * 17 + (w.config.seed % 225)) % 225;
        let sum = 0;
        idx = 5;
        for (let j = 0; j < 6; j++) {
          sum += proportions[j];
          if (target < sum) {
            idx = j;
            break;
          }
        }
        if (y === Math.floor(size / 2)) idx = x === 3 || x === size - 4 ? 2 : 5;
        count[idx]++;
        const biome = biomes[idx];
        const e: EcoTile = {
          region,
          biome,
          area: 6.25,
          slope: biome === 'hill' ? 0.35 : 0.03,
          soilWater: 90,
          waterCapacity: 180,
          nitrogen: 180 * 6.25,
          organic: 3,
          erosion: 0,
          surfaceWater: biome === 'water' ? 100000 : biome === 'wetland' ? 20000 : 500,
          contamination: 0.01,
          biomass: {},
          capacity: {},
          deposits: [],
          ground: [],
          fields: [],
          structures: [],
          herds: [],
          improvements: {},
          disturbance: 0,
        };
        regionTiles.push({
          x,
          y,
          eco: e,
          terrain: biome === 'hill' ? 'hill' : 'plain',
          resources: {},
          ground: {},
          lastGather: 0,
          farm: 0,
          farmFood: 0,
          shelter: null,
        });
      }
    for (const t of regionTiles) {
      const e = t.eco!,
        i = biomes.indexOf(e.biome);
      const scale = (size * size) / 225;
      for (const [id, total] of Object.entries(totals[e.biome] ?? {})) {
        const annual = (total * scale) / count[i];
        e.capacity[id] = annual;
        e.biomass[id] = annual * (id === 'nuts' || id === 'grain' ? 0.15 : 0.08);
      }
      if (e.biome === 'forest') {
        e.capacity.green_wood = 250000;
        e.biomass.green_wood = 200000;
        e.capacity.wood = 2000;
        e.biomass.wood = 1000;
        e.capacity.bark = 1000;
        e.biomass.bark = 600;
        e.capacity.resin = 40;
        e.biomass.resin = 20;
        e.capacity.game = (6000 / count[0]) * scale;
        e.biomass.game = e.capacity.game * 0.65;
      }
      if (e.biome === 'meadow' || e.biome === 'wetland') {
        e.capacity.flax_seed = 4;
        e.biomass.flax_seed = 2;
        e.capacity.grass_seed = 4;
        e.biomass.grass_seed = 2;
        e.capacity.reeds = 800;
        e.biomass.reeds = 400;
        e.capacity.hay = 6.25 * 2000;
        e.biomass.hay = 1000;
      }
      if (e.biome === 'water') {
        e.capacity.fish = (48000 / count[5]) * scale;
        e.biomass.fish = e.capacity.fish * 0.6;
      }
      const deposits: Record<string, number> = {
        stone: 30000,
        flint: 200,
        clay: 15000,
        sand: 10000,
        refractory: e.biome === 'hill' ? 5000 : 0,
      };
      if (e.biome === 'hill') {
        deposits.iron_ore = 10000;
        deposits.copper_ore = region === 1 ? 8000 : region === 0 ? 300 : 0;
        deposits.tin_ore = region === 2 ? 2000 : 0;
        deposits.salt = region === 2 ? 10000 : 100;
      }
      e.deposits = Object.entries(deposits)
        .filter(([, n]) => n > 0)
        .map(([item, kg]) => ({
          item,
          kg,
          grade:
            item === 'copper_ore'
              ? 0.15
              : item === 'tin_ore'
                ? 0.3
                : item === 'iron_ore'
                  ? 0.45
                  : 1,
          depth: 0,
        }));
    }
    tiles.push(...regionTiles);
  }
  w.tiles = tiles;
  if (w.config.spawn === 'compact') {
    // Keep the whole starting group together on four dry tiles in the river valley.
    const candidates: { x: number; y: number; distance: number }[] = [];
    const center = Math.floor(size / 2) - 1;
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++)
        if (
          [0, 1, 2, 3].every(
            (i) => ecoAt(w, x + (i % 2), y + Math.floor(i / 2)).eco!.biome !== 'water',
          )
        )
          candidates.push({ x, y, distance: (x - center) ** 2 + (y - center) ** 2 });
    const anchor = candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)[0];
    if (!anchor) throw new Error('地图中没有可供扎堆出生的 2×2 陆地');
    w.agents.forEach((a, i) => {
      a.x = anchor.x + (i % 2);
      a.y = anchor.y + (Math.floor(i / 2) % 2);
    });
  }
  for (const a of w.agents) {
    initBody(w, a);
    if (ecoAt(w, a.x, a.y).eco!.biome === 'water') a.y = Math.max(0, a.y - 1);
  }
  if (w.config.ecoPreset === 'settlement') {
    for (const [i, a] of w.agents.entries()) {
      a.eco!.knowledge = [
        ...new Set([...a.eco!.knowledge, 'farming', 'sickle', 'hoe', 'flour', 'porridge']),
      ];
      a.eco!.stock.push(batch('grain', 5, w.tick, `seed-${i}`, '农业开局实物种粮'));
    }
    const t = ecoAt(w, Math.floor(size / 2), Math.floor(size / 2) - 1).eco!;
    for (const kind of ['hearth', 'granary', 'pen'])
      t.structures.push({
        id: `initial-${kind}`,
        kind,
        progress: BUILDINGS[kind].minutes,
        condition: 1,
        contents: [],
      });
    t.herds.push({
      id: 'initial-goats',
      species: 'goat',
      count: 10,
      females: 5,
      health: 100,
      hunger: 0,
      milkDay: 0,
      offspringProgress: 0,
    });
    t.ground.push(
      batch('hay', 1800, w.tick, 'initial-hay', '农业开局冬草'),
      batch('grain', 500, w.tick, 'initial-grain', '农业开局实物储粮'),
    );
  }
  if (w.config.ecoPreset === 'village') initVillage(w);
  initWildlife(w);
}
