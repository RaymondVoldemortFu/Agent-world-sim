import type { World } from '../sim/types';
import { BUILDINGS, CROPS, ITEMS } from './catalog';
import { batch } from './batches';
import { climate, ecoAt } from './world';

/** A finite inherited farming estate. All assets enter the initial replay snapshot. */
export function initVillage(w: World) {
  const x = Math.min(...w.agents.map((a) => a.x)),
    y = Math.min(...w.agents.map((a) => a.y));
  const population = w.agents.length,
    farmlandHa = population * 0.35;
  const foodKg = (population * 45 * 2500) / ITEMS.grain.kcal;
  const seedKg = farmlandHa * CROPS.grain.seed;
  const cells = [0, 1, 2, 3].map((i) => ecoAt(w, x + (i % 2), y + Math.floor(i / 2)).eco!);
  const add = (index: number, kind: string) => {
    const structure = {
      id: `village-${index}-${kind}`,
      kind,
      progress: BUILDINGS[kind].minutes,
      condition: 1,
      contents: [] as ReturnType<typeof batch>[],
    };
    cells[index].structures.push(structure);
    return structure;
  };
  const day = w.ecology!.climate.day;
  const crop = day >= 260 || day < 60 ? 'winter_grain' : 'grain';
  const sowDay = crop === 'winter_grain' ? (day < 60 ? 285 - 365 : 285) : 100;
  let gdd = 0;
  for (let d = sowDay; d < day; d++)
    gdd +=
      Math.max(0, climate(((((d - 1) % 365) + 365) % 365) + 1, w.config.seed).temperature - 5) *
      0.85;
  // A summer harvested estate or a pre-sowing estate starts with prepared fields.
  const growing = day >= sowDay && gdd < CROPS[crop].gdd && !(day >= 244 && day < 260);
  cells.forEach((t, i) => {
    t.biome = 'floodplain';
    t.slope = 0.02;
    t.soilWater = Math.max(t.soilWater, 100);
    t.waterCapacity = Math.max(t.waterCapacity, 140);
    t.surfaceWater = Math.max(t.surfaceWater, 2000);
    t.nitrogen = Math.max(t.nitrogen, t.area * 120);
    const area = farmlandHa / 4;
    t.fields.push({
      id: `village-field-${i}`,
      area,
      stage: growing ? 'growing' : 'prepared',
      ...(growing
        ? { crop, planted: w.tick - (day - sowDay), seededKg: area * CROPS[crop].seed }
        : {}),
      gdd: growing ? gdd : 0,
      biomass: growing ? gdd / CROPS[crop].gdd : 0,
      work: 25 * area * 120,
      harvestWork: 0,
      waterStress: 0,
      fertility: 1,
      harvestKg: 0,
    });
    // Cultivated land replaces its share of the previous wild food and timber stock.
    for (const key of Object.keys(t.biomass)) t.biomass[key] *= Math.max(0, 1 - area / t.area);
    const residents = w.agents.filter((a) => a.x === x + (i % 2) && a.y === y + Math.floor(i / 2));
    if (residents.length) add(i, residents.length > 6 ? 'longhouse' : 'house');
    add(i, 'hearth');
    add(i, 'well');
    const granary = add(i, 'granary');
    granary.contents.push(
      batch('grain', (foodKg + seedKg) / 4, w.tick, `village-grain-${i}`, '村落储粮与下一季种粮'),
    );
    const tools = add(i, 'workshop');
    for (const item of ['hoe', 'sickle', 'flake', 'handaxe', 'quern', 'wood_tablet'])
      tools.contents.push(
        batch(item, ITEMS[item].unitKg ?? 1, w.tick, `village-tool-${i}-${item}`, '村落共有农具'),
      );
  });
  const board = add(0, 'noticeboard');
  board.contents.push({
    ...batch('inscribed_wood', 1, w.tick, 'village-warning-board', '原住民告示'),
    inscription: {
      id: 'village-warning',
      authorId: -1,
      authorName: '原住民',
      day: 0,
      eventSeq: 0,
      text: '野兽非常危险！！需要武器！！',
    },
  });
  w.ecology!.relicCorpses = [0, 1, 2].map((i) => ({
    id: -1 - i,
    name: `原住民${i + 1}`,
    x: x + (i % 2),
    y: y + Math.floor(i / 2),
    region: 0,
  }));
  const pen = add(0, 'pen');
  const goats = Math.max(2, Math.ceil(population / 3));
  pen.contents.push(batch('hay', goats * 1.5 * 30, w.tick, 'village-hay', '村落30天补充草料'));
  cells[0].herds.push({
    id: 'village-goats',
    species: 'goat',
    count: goats,
    females: Math.ceil(goats / 2),
    health: 100,
    hunger: 0,
    milkDay: 0,
    offspringProgress: 0,
  });
  w.ecology!.village = { region: 0, x, y, farmlandHa, foodKg, seedKg };
  for (const a of w.agents) {
    a.eco!.knowledge = [
      ...new Set([
        ...a.eco!.knowledge,
        'farming',
        'hoe',
        'sickle',
        'flour',
        'porridge',
        'build:granary',
        'build:house',
        'build:noticeboard',
      ]),
    ];
    a.brain!.movement = { returnAfterGather: true };
    a.memories.push({
      id: `village-origin-${a.id}`,
      day: w.tick,
      source: 'observed',
      eventIds: [],
      importance: 8,
      content: `你居住在河谷(${x},${y})到(${x + 1},${y + 1})的初始村落。四格有农田、住宅、水井、粮仓和共有农具。村落有原住民遗体，告示板位于(${x},${y})，可前往阅读并用板材和切削工具添加铭文。粮仓谷物含下一季种粮，需协商食用和播种。你默认采食后返回出发地，可以自行调整移动约束。`,
    });
  }
}
