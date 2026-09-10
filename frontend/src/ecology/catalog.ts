/** eco-1 reference batch catalogue. Mass in kg, work in person-minutes. */
export interface ItemDef {
  name: string;
  kcal: number;
  moisture: number;
  life: number;
  capacity?: number;
  unitKg?: number;
  capabilities?: Record<string, number>;
  durability?: number;
  combat?: { attack?: number; armor?: number; shield?: number };
}
export const ITEMS: Record<string, ItemDef> = {};
function item(
  id: string,
  name: string,
  kcal = 0,
  moisture = 0,
  life = Infinity,
  capabilities?: Record<string, number>,
  durability = 1000,
  capacity?: number,
) {
  ITEMS[id] = {
    name,
    kcal,
    moisture,
    life: Number.isFinite(life) ? life : 1e9,
    capabilities,
    durability,
    capacity,
  };
}
item('flax_seed', '亚麻种子');
item('grass_seed', '牧草种子');
item('nuts', '干坚果', 5500, 0.12, 240);
item('berries', '鲜果', 500, 0.85, 5);
item('roots', '根茎', 1000, 0.7, 21);
item('grain', '谷粒 / 种子', 3400, 0.13, 365);
item('pulses', '豆粒 / 种子', 3300, 0.13, 300);
item('fish', '整鱼', 605, 0.75, 1.5);
item('meat', '鲜肉', 1600, 0.7, 1.5);
item('cooked_meat', '熟肉', 2000, 0.55, 1);
item('dry_meat', '干肉', 4000, 0.15, 80);
item('dry_fish', '干鱼', 3000, 0.15, 80);
item('flour', '面粉', 3542, 0.12, 100);
item('porridge', '粥', 1133, 0.7, 1);
item('milk', '奶', 700, 0.88, 1);
item('cheese', '乳酪', 2800, 0.4, 20);
for (const [id, name] of Object.entries({
  wood: '干木',
  green_wood: '鲜木',
  bark: '树皮 / 鲜茎',
  fiber: '干纤维',
  cord: '绳索',
  resin: '树脂',
  bone: '骨',
  hide: '生皮',
  leather: '处理皮',
  fat: '脂',
  feather: '羽毛',
  yarn: '纱',
  cloth: '布',
  reeds: '苇草',
  hay: '干草',
  manure: '粪肥',
  water: '水',
  clay: '黏土',
  refractory: '耐火土',
  stone: '石料',
  flint: '燧石',
  sand: '砂',
  salt: '盐',
  copper_ore: '铜矿 (15% Cu)',
  tin_ore: '锡矿 (30% SnO₂)',
  iron_ore: '铁矿 (45% Fe)',
  roasted_ore: '焙烧铁矿',
  charcoal: '木炭',
  copper: '铜',
  tin: '锡',
  bronze: '青铜',
  bloom: '海绵铁',
  iron: '熟铁',
  scrap_bronze: '青铜废料',
  scrap_iron: '铁废料',
  slag: '炉渣',
  ash: '灰',
  waste: '碎屑',
  straw: '秸秆',
  green_pot: '陶坯',
  wheel: '轮轴',
}))
  item(id, name);
ITEMS.green_wood.moisture = 0.5;
ITEMS.bark.moisture = 0.7;
ITEMS.water.moisture = 1;
item('flake', '石片', 0, 0, 1e9, { cutting: 1 }, 600);
item('handaxe', '手斧', 0, 0, 1e9, { digging: 1, hammer: 1, cutting: 0.5 }, 2000);
item('axehead', '磨制斧头');
item('axe', '柄装石斧', 0, 0, 1e9, { woodwork: 1, cutting: 1 }, 5000);
item('digging_stick', '掘棒', 0, 0, 1e9, { digging: 0.7 }, 1800);
item('needle', '骨针', 0, 0, 1e9, { boring: 1 }, 3000);
item('spear', '石矛', 0, 0, 1e9, { hunting: 1 }, 2500);
item('bow', '弓箭组', 0, 0, 1e9, { hunting: 1.6 }, 4000);
item('drill', '弓钻', 0, 0, 1e9, { boring: 1, fire: 1 }, 3000);
item('basket', '编筐', 0, 0, 1e9, {}, 5000, 10);
item('net', '渔网', 0, 0, 1e9, { fishing: 3 }, 4000);
item('clothes', '皮衣鞋', 0, 0, 1e9, { warmth: 1 }, 12000);
item('pot', '陶器', 0, 0, 1e9, { cooking: 1 }, 8000);
item('quern', '磨盘', 0, 0, 1e9, { grinding: 1 }, 16000);
item('bellows', '风箱', 0, 0, 1e9, { airflow: 1 }, 5000);
item('crucible', '坩埚', 0, 0, 1e9, { smelting: 1 }, 2500);
item('mold', '铸模', 0, 0, 1e9, { casting: 1 }, 2000);
item('hammer', '锤砧组', 0, 0, 1e9, { hammer: 2 }, 16000);
item('bronze_axe', '青铜斧', 0, 0, 1e9, { woodwork: 1.7, cutting: 1.5 }, 10000);
item('iron_axe', '铁斧', 0, 0, 1e9, { woodwork: 1.8, cutting: 1.6 }, 12000);
item('sickle', '石镰', 0, 0, 1e9, { reaping: 1 }, 4000);
item('iron_sickle', '铁镰', 0, 0, 1e9, { reaping: 1.6 }, 12000);
item('hoe', '石锄', 0, 0, 1e9, { digging: 1.5 }, 5000);
item('canoe', '独木舟', 0, 0, 1e9, { boat: 1 }, 30000, 200);
item('raft', '木筏', 0, 0, 1e9, { boat: 0.6 }, 12000, 150);
item('sledge', '拖橇', 0, 0, 1e9, { haul: 1 }, 16000, 80);
item('cart', '牛车', 0, 0, 1e9, { haul: 2 }, 30000, 200);
item('wood_tablet', '空白木板');
item('stone_tablet', '空白石板');
item('inscribed_wood', '刻字木板');
item('inscribed_stone', '刻字石板');
item('club', '硬木棍', 0, 0, 1e9, { fighting: 1 }, 1600);
item('bronze_spear', '青铜矛', 0, 0, 1e9, { hunting: 1.8, fighting: 1 }, 6500);
item('iron_spear', '铁矛', 0, 0, 1e9, { hunting: 2, fighting: 1 }, 8000);
item('hide_armor', '生皮护具', 0, 0, 1e9, { armor: 1 }, 1800);
item('leather_armor', '皮甲', 0, 0, 1e9, { armor: 1 }, 4000);
item('bronze_armor', '青铜札甲', 0, 0, 1e9, { armor: 1 }, 7000);
item('wooden_shield', '木皮盾', 0, 0, 1e9, { shield: 1 }, 2400);
for (const [id, attack] of Object.entries({
  club: 12,
  spear: 22,
  bow: 28,
  bronze_spear: 34,
  iron_spear: 40,
  handaxe: 10,
  axe: 16,
  bronze_axe: 24,
  iron_axe: 28,
}))
  ITEMS[id].combat = { attack };
ITEMS.hide_armor.combat = { armor: 0.12 };
ITEMS.leather_armor.combat = { armor: 0.25 };
ITEMS.bronze_armor.combat = { armor: 0.42 };
ITEMS.wooden_shield.combat = { shield: 0.18 };
export interface Recipe {
  id: string;
  name: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  minutes: number;
  days: number;
  skill: string;
  capability?: string;
  facility?: string;
  tend?: number;
  starter?: boolean;
}
export const RECIPES: Record<string, Recipe> = {};
function recipe(
  id: string,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  ap: number,
  days = 0,
  skill = 'craft',
  capability?: string,
  facility?: string,
  tend?: number,
  starter = false,
) {
  RECIPES[id] = {
    id,
    name: ITEMS[id]?.name ?? id,
    inputs,
    outputs,
    minutes: Math.round(ap * 120),
    days,
    skill,
    capability,
    facility,
    tend,
    starter,
  };
}
recipe(
  'flake',
  { flint: 1 },
  { flake: 0.35, waste: 0.65 },
  0.6,
  0,
  'stone',
  undefined,
  undefined,
  undefined,
  true,
);
recipe(
  'handaxe',
  { stone: 1.5 },
  { handaxe: 0.8, waste: 0.7 },
  1.5,
  0,
  'stone',
  undefined,
  undefined,
  undefined,
  true,
);
recipe('axehead', { stone: 1.5, sand: 0.1, water: 0.2 }, { axehead: 1 }, 3, 0, 'stone', 'grinding');
recipe('axe', { axehead: 1, wood: 0.6, cord: 0.05, resin: 0.05 }, { axe: 1.7 }, 1, 0, 'woodwork');
recipe(
  'digging_stick',
  { wood: 1.2 },
  { digging_stick: 0.8 },
  0.5,
  0,
  'woodwork',
  'cutting',
  undefined,
  undefined,
  true,
);
recipe('needle', { bone: 0.2 }, { needle: 0.03 }, 1, 0, 'craft', 'cutting');
recipe(
  'spear',
  { wood: 1, flake: 0.15, cord: 0.03, resin: 0.02 },
  { spear: 1.2 },
  1,
  0,
  'woodwork',
  'cutting',
);
recipe(
  'bow',
  { wood: 1.2, cord: 0.05, flake: 0.15, feather: 0.02 },
  { bow: 1.2 },
  3,
  3,
  'woodwork',
  'cutting',
);
recipe(
  'drill',
  { wood: 0.5, cord: 0.05, flake: 0.03 },
  { drill: 0.58 },
  1,
  0,
  'woodwork',
  'cutting',
);
recipe('fiber', { bark: 5, water: 2 }, { fiber: 1 }, 1, 5, 'fiber', undefined, undefined, 2, true);
recipe('cord', { fiber: 1 }, { cord: 0.9 }, 1, 0, 'fiber', undefined, undefined, undefined, true);
recipe('basket', { reeds: 2, cord: 0.1 }, { basket: 1.8 }, 2, 0, 'fiber');
recipe('net', { cord: 2, stone: 0.5, wood: 0.2 }, { net: 2.7 }, 5, 0, 'fiber');
recipe(
  'leather',
  { hide: 5, fat: 0.2, water: 3 },
  { leather: 2 },
  3,
  3,
  'leather',
  'cutting',
  'hearth',
  1,
);
recipe('clothes', { leather: 2, cord: 0.1 }, { clothes: 2 }, 3, 0, 'leather', 'boring');
recipe('yarn', { fiber: 1 }, { yarn: 0.85 }, 4, 0, 'fiber');
recipe('cloth', { yarn: 1 }, { cloth: 0.95 }, 4, 0, 'fiber', undefined, 'workshop');
recipe('canoe', { wood: 300 }, { canoe: 100 }, 35, 7, 'woodwork', 'woodwork');
recipe('raft', { wood: 180, cord: 5 }, { raft: 185 }, 12, 0, 'woodwork');
recipe('sledge', { wood: 25, cord: 1 }, { sledge: 26 }, 6, 0, 'woodwork', 'woodwork');
recipe('wheel', { wood: 40 }, { wheel: 25 }, 15, 0, 'woodwork', 'boring');
recipe('cart', { wood: 100, wheel: 25, leather: 3 }, { cart: 110 }, 30, 0, 'woodwork', 'woodwork');
recipe('wood', { green_wood: 20 }, { wood: 10 }, 0.2, 30, 'woodwork');
recipe(
  'quern',
  { stone: 15, sand: 1 },
  { quern: 12 },
  4,
  0,
  'stone',
  undefined,
  undefined,
  undefined,
  true,
);
recipe(
  'sickle',
  { wood: 0.8, flake: 0.2, cord: 0.05, resin: 0.05 },
  { sickle: 1.1 },
  1.5,
  0,
  'woodwork',
  'cutting',
);
recipe('hoe', { stone: 1.5, wood: 1, cord: 0.1 }, { hoe: 2.4 }, 3, 0, 'stone', 'hammer');
recipe(
  'cooked_meat',
  { meat: 5, wood: 2 },
  { cooked_meat: 4, ash: 0.04 },
  0.6,
  0,
  'cooking',
  undefined,
  'hearth',
);
recipe(
  'dry_meat',
  { meat: 10, wood: 5 },
  { dry_meat: 4, ash: 0.1 },
  1,
  3,
  'cooking',
  'cutting',
  'drying_rack',
  1,
);
recipe(
  'dry_fish',
  { fish: 10, wood: 5 },
  { dry_fish: 2, ash: 0.1 },
  1,
  3,
  'cooking',
  'cutting',
  'drying_rack',
  1,
);
recipe(
  'salt_meat',
  { meat: 10, salt: 1 },
  { dry_meat: 4 },
  1,
  3,
  'cooking',
  'cutting',
  'drying_rack',
);
recipe('flour', { grain: 4 }, { flour: 3.84 }, 1, 0, 'cooking', 'grinding');
recipe(
  'porridge',
  { flour: 1, water: 2, wood: 0.5 },
  { porridge: 3, ash: 0.01 },
  0.25,
  0,
  'cooking',
  'cooking',
  'hearth',
);
recipe('cheese', { milk: 10 }, { cheese: 2.5 }, 1, 1, 'cooking', 'cooking');
recipe('green_pot', { clay: 15, sand: 3, water: 4 }, { green_pot: 18 }, 3, 5, 'pottery');
recipe(
  'pot',
  { green_pot: 18, wood: 25 },
  { pot: 15, ash: 0.5 },
  2,
  1,
  'pottery',
  undefined,
  'kiln',
  1,
);
recipe(
  'crucible',
  { refractory: 4, sand: 1, wood: 6 },
  { crucible: 4, ash: 0.12 },
  2,
  2,
  'pottery',
  undefined,
  'kiln',
  1,
);
recipe(
  'mold',
  { clay: 4, sand: 2, wood: 4 },
  { mold: 5, ash: 0.08 },
  2,
  2,
  'pottery',
  undefined,
  'kiln',
);
recipe(
  'bellows',
  { leather: 2, wood: 2, cord: 0.2, pot: 0.5 },
  { bellows: 4 },
  4,
  0,
  'leather',
  'boring',
);
recipe('hammer', { stone: 12, wood: 1, cord: 0.1 }, { hammer: 12 }, 3, 0, 'stone');
recipe(
  'charcoal',
  { wood: 80 },
  { charcoal: 20, ash: 1.6 },
  3,
  4,
  'charcoal',
  undefined,
  'charcoal_pit',
  1,
);
recipe(
  'copper',
  { copper_ore: 10, charcoal: 7 },
  { copper: 1.06875, slag: 8.93125 },
  5,
  1,
  'metal',
  'smelting',
  'furnace',
  1,
);
recipe(
  'tin',
  { tin_ore: 5, charcoal: 4 },
  { tin: 0.7092, slag: 4.2908 },
  3,
  1,
  'metal',
  'smelting',
  'furnace',
  1,
);
recipe(
  'bronze',
  { copper: 1.08, tin: 0.12, charcoal: 2 },
  { bronze: 1.14, scrap_bronze: 0.06 },
  2,
  0,
  'metal',
  'smelting',
  'furnace',
);
recipe(
  'bronze_axe',
  { bronze: 1, wood: 0.6, cord: 0.05, charcoal: 1 },
  { bronze_axe: 1.55, scrap_bronze: 0.1 },
  2,
  0,
  'metal',
  'casting',
  'forge',
);
recipe(
  'roasted_ore',
  { iron_ore: 10, wood: 3 },
  { roasted_ore: 9, ash: 0.06 },
  1,
  1,
  'metal',
  undefined,
  'hearth',
);
recipe(
  'bloom',
  { roasted_ore: 9, charcoal: 16 },
  { bloom: 3, slag: 6 },
  8,
  1,
  'metal',
  'airflow',
  'bloomery',
  1,
);
recipe(
  'iron',
  { bloom: 3, charcoal: 4 },
  { iron: 1.296, slag: 1.704 },
  3,
  0,
  'metal',
  'hammer',
  'forge',
);
recipe(
  'iron_axe',
  { iron: 1, wood: 0.6, cord: 0.05, charcoal: 1 },
  { iron_axe: 1.55, scrap_iron: 0.1 },
  2,
  0,
  'metal',
  'hammer',
  'forge',
);
recipe(
  'iron_sickle',
  { iron: 0.5, wood: 0.4, charcoal: 1 },
  { iron_sickle: 0.85, scrap_iron: 0.05 },
  2,
  0,
  'metal',
  'hammer',
  'forge',
);
recipe(
  'recycle_bronze',
  { scrap_bronze: 1, charcoal: 1 },
  { bronze: 0.95, slag: 0.05 },
  1,
  0,
  'metal',
  'smelting',
  'furnace',
);
recipe(
  'recycle_iron',
  { scrap_iron: 1, charcoal: 2 },
  { iron: 0.8, slag: 0.2 },
  2,
  0,
  'metal',
  'hammer',
  'forge',
);
export interface Building {
  name: string;
  area: number;
  inputs: Record<string, number>;
  minutes: number;
  storage: number;
  shelter: number;
  decay: number;
  wall?: { tier: number; durability: number };
}
export const BUILDINGS: Record<string, Building> = {};
function building(
  id: string,
  name: string,
  m2: number,
  inputs: Record<string, number>,
  ap: number,
  storage = 0,
  shelter = 0,
  decay = 0.0005,
) {
  BUILDINGS[id] = { name, area: m2 / 10000, inputs, minutes: ap * 120, storage, shelter, decay };
}
building('camp', '营棚', 12, { wood: 60, reeds: 20, cord: 1 }, 12, 50, 4, 0.002);
building('house', '木骨泥屋', 24, { wood: 400, clay: 1000, reeds: 120, cord: 5 }, 90, 300, 6);
building('longhouse', '共居屋', 60, { wood: 850, clay: 2100, reeds: 260, cord: 12 }, 190, 1000, 15);
building('hearth', '炉灶', 2, { stone: 60, clay: 20 }, 5);
building('drying_rack', '晒架烟棚', 12, { wood: 80, cord: 2, reeds: 20 }, 15, 50);
building('granary', '小粮仓', 12, { wood: 250, clay: 500, reeds: 80 }, 50, 4000);
building('large_granary', '聚落粮仓', 36, { wood: 600, clay: 1500, reeds: 180 }, 120, 12000);
building('workshop', '工棚织架', 16, { wood: 120, cord: 3, reeds: 40 }, 30, 100);
building('kiln', '陶窑', 8, { refractory: 200, stone: 100 }, 20);
building('charcoal_pit', '炭堆场', 20, { clay: 100 }, 8);
building('furnace', '铜锡炉', 4, { refractory: 80, stone: 60 }, 18);
building('bloomery', '块炼炉', 4, { refractory: 120, stone: 80, bellows: 4 }, 25);
building('forge', '锻工棚', 12, { wood: 80, clay: 100, stone: 80, hammer: 12 }, 20);
building('pen', '畜圈草棚', 50, { wood: 150, reeds: 100 }, 30, 2000);
building('noticeboard', '村落告示板', 2, { wood: 10, cord: 1 }, 2, 100);
building('well', '浅井', 4, { stone: 200, wood: 60, cord: 2 }, 50);
building('bridge', '简桥码头', 30, { wood: 300, cord: 5, stone: 100 }, 40);
building('palisade', '一级木栅墙', 100, { wood: 240, cord: 8, stone: 40 }, 30, 0, 0, 0.002);
building('earth_wall', '二级夯土围墙', 160, { clay: 600, stone: 180, wood: 60, water: 100 }, 70);
building('stone_wall', '三级干砌石墙', 180, { stone: 1200, wood: 60, cord: 4 }, 130);
building('fortified_wall', '四级加固石墙', 240, { stone: 1800, iron: 20, wood: 160, cord: 8 }, 220);
for (const [kind, tier, durability] of [
  ['palisade', 1, 180],
  ['earth_wall', 2, 420],
  ['stone_wall', 3, 850],
  ['fortified_wall', 4, 1400],
] as const)
  BUILDINGS[kind].wall = { tier, durability };

export const CROPS: Record<
  string,
  {
    name: string;
    seed: number;
    yield: number;
    gdd: number;
    plant: [number, number];
    nitrogen: number;
    harvest: number;
  }
> = {
  grain: {
    name: '春谷',
    seed: 120,
    yield: 750,
    gdd: 1200,
    plant: [65, 130],
    nitrogen: 13.5,
    harvest: 90,
  },
  winter_grain: {
    name: '秋播谷',
    seed: 120,
    yield: 750,
    gdd: 1450,
    plant: [260, 310],
    nitrogen: 13.5,
    harvest: 90,
  },
  pulses: {
    name: '豆类',
    seed: 100,
    yield: 500,
    gdd: 1000,
    plant: [80, 150],
    nitrogen: -17.5,
    harvest: 70,
  },
  flax: {
    name: '亚麻',
    seed: 60,
    yield: 700,
    gdd: 1100,
    plant: [75, 140],
    nitrogen: 10,
    harvest: 80,
  },
  hay: {
    name: '牧草',
    seed: 15,
    yield: 2000,
    gdd: 900,
    plant: [65, 150],
    nitrogen: 8,
    harvest: 35,
  },
};
recipe(
  'club',
  { wood: 1.5 },
  { club: 1.2, waste: 0.3 },
  0.5,
  0,
  'woodwork',
  undefined,
  undefined,
  undefined,
  true,
);
recipe(
  'hide_armor',
  { hide: 3, cord: 0.2 },
  { hide_armor: 3, waste: 0.2 },
  2,
  0,
  'leather',
  'cutting',
);
recipe(
  'leather_armor',
  { leather: 3, cord: 0.2 },
  { leather_armor: 3, waste: 0.2 },
  3,
  0,
  'leather',
  'boring',
);
recipe(
  'wooden_shield',
  { wood: 2, leather: 0.6, cord: 0.2 },
  { wooden_shield: 2.5, waste: 0.3 },
  2,
  0,
  'woodwork',
  'cutting',
);
recipe(
  'bronze_spear',
  { bronze: 0.8, wood: 1, cord: 0.1, charcoal: 1 },
  { bronze_spear: 1.8, scrap_bronze: 0.1 },
  3,
  0,
  'metal',
  'casting',
  'forge',
);
recipe(
  'iron_spear',
  { iron: 0.8, wood: 1, cord: 0.1, charcoal: 1 },
  { iron_spear: 1.8, scrap_iron: 0.1 },
  3,
  0,
  'metal',
  'hammer',
  'forge',
);
recipe(
  'bronze_armor',
  { bronze: 4, leather: 1, cord: 0.2, charcoal: 2 },
  { bronze_armor: 5, scrap_bronze: 0.2 },
  10,
  0,
  'metal',
  'casting',
  'forge',
);

export const STARTER_KNOWLEDGE = Object.values(RECIPES)
  .filter((r) => r.starter)
  .map((r) => r.id);
export function catalogErrors() {
  const errors: string[] = [];
  for (const r of Object.values(RECIPES)) {
    const mass = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
    const kcal = (v: Record<string, number>) =>
      Object.entries(v).reduce((a, [k, n]) => a + n * (ITEMS[k]?.kcal ?? 0), 0);
    if (mass(r.outputs) > mass(r.inputs) + 1e-8) errors.push(`${r.id}: mass creation`);
    if (kcal(r.outputs) > kcal(r.inputs) * 1.001) errors.push(`${r.id}: energy creation`);
    for (const id of [...Object.keys(r.inputs), ...Object.keys(r.outputs)])
      if (!ITEMS[id]) errors.push(`unknown ${id}`);
  }
  return errors;
}

// A fragment of a tool or vehicle cannot provide a whole tool's capacity.
for (const [id, item] of Object.entries(ITEMS))
  if (item.capabilities || item.capacity)
    item.unitKg = id === 'pot' ? 1.25 : (RECIPES[id]?.outputs[id] ?? 0.01);
