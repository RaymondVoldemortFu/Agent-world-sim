import {
  DEFAULT_CONFIG,
  ConfigSchema,
  type World,
  type Config,
  type Agent,
  type Tile,
  type Inventory,
  type Item,
} from './types';
export const RULES_VERSION = 'mvp-1.0.0';
export function rand(w: { rng: number }) {
  w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
  return w.rng / 4294967296;
}
export const weight = (inv: Inventory) =>
  Object.entries(inv).reduce((n, [k, v]) => n + (v ?? 0) * (k.endsWith('tool') ? 2 : 1), 0);
export const count = (inv: Inventory, key: Item) => inv[key] ?? 0;
export function add(inv: Inventory, key: Item, n: number) {
  inv[key] = count(inv, key) + n;
  if (inv[key] === 0) delete inv[key];
}
export const tileAt = (w: World, x: number, y: number) => w.tiles[y * w.config.size + x];
export const living = (w: World) => w.agents.filter((a) => !a.death);
export const adult = (w: World, a: Agent) => a.age >= w.config.adultAge;
export const visible = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
export function makeAgent(w: World, x: number, y: number, parents: number[] = []): Agent {
  const id = w.nextId++;
  const names = [
    '岚',
    '川',
    '禾',
    '砾',
    '苇',
    '松',
    '穗',
    '青',
    '林',
    '棠',
    '舟',
    '桑',
    '原',
    '鹿',
    '云',
    '石',
    '月',
    '溪',
    '竹',
    '叶',
  ];
  return {
    id,
    name: names[Math.floor(rand(w) * names.length)],
    sex: rand(w) < 0.5 ? 'F' : 'M',
    age: parents.length ? 0 : Math.max(30, w.config.adultAge),
    parents,
    x,
    y,
    hp: 100,
    hunger: parents.length ? 60 : 100,
    ap: 0,
    inventory: parents.length ? {} : { food: 3 },
    personality: Array.from({ length: 5 }, () => Math.round(rand(w) * 100) / 100),
    recipes: [],
    intent: '',
    memories: [],
    inbox: [],
    claims: [],
    cooldownUntil: 0,
  };
}
export function createWorld(overrides: Partial<Config> = {}, id?: string): World {
  const config = ConfigSchema.parse({ ...DEFAULT_CONFIG, ...overrides });
  const size = config.size;
  const w: World = {
    version: 1,
    rulesVersion: RULES_VERSION,
    id: id ?? `world-${config.seed}-${Date.now()}`,
    config,
    tick: 1,
    seq: 0,
    nextId: 1,
    rng: config.seed,
    tiles: [],
    agents: [],
    proposals: [],
    cursor: { phase: 'actions', round: 0, index: 0, ids: [] },
    metrics: [],
    usage: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      elapsedMs: 0,
      errors: 0,
      repairs: 0,
      consecutiveErrors: 0,
      estimated: false,
      cost: 0,
      model: '未连接',
    },
    counters: {
      births: 0,
      deaths: 0,
      chats: 0,
      gifts: 0,
      attacks: 0,
      experiments: 0,
      discoveries: 0,
      failures: 0,
    },
  };
  const n = Math.ceil(size / 8) + 1;
  const heights = Array.from({ length: n * n }, () => rand(w));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / 8),
        gy = Math.floor(y / 8),
        fx = x / 8 - gx,
        fy = y / 8 - gy;
      const h =
        (heights[gy * n + gx] * (1 - fx) + heights[gy * n + gx + 1] * fx) * (1 - fy) +
        (heights[(gy + 1) * n + gx] * (1 - fx) + heights[(gy + 1) * n + gx + 1] * fx) * fy;
      w.tiles.push({
        x,
        y,
        terrain: 'plain',
        resources: {},
        lastGather: -10,
        farm: 0,
        farmFood: 0,
        ground: {},
        shelter: null,
        _height: h,
      } as Tile);
    }
  const sorted = [...w.tiles].sort((a, b) => (a as any)._height - (b as any)._height);
  sorted.forEach((t, i) => {
    t.terrain = i < sorted.length * 0.55 ? 'plain' : i < sorted.length * 0.85 ? 'hill' : 'mountain';
    t.resources =
      t.terrain === 'plain'
        ? { food: 6, wood: 8 + Math.floor(rand(w) * 9) }
        : t.terrain === 'hill'
          ? { food: 3, wood: 5, stone: 12 }
          : { stone: 20, ...(rand(w) < 0.4 ? { ore: 10 } : {}) };
    delete (t as any)._height;
  });
  const c = Math.floor(size / 2),
    d = Math.min(5, Math.floor(size / 5));
  const centers = [
    [c - d, c - d],
    [c + d, c - d],
    [c - d, c + d],
    [c + d, c + d],
  ];
  for (let i = 0; i < config.population; i++) {
    const center = centers[i % 4];
    const x =
      config.spawn === 'uniform'
        ? Math.floor(rand(w) * size)
        : Math.max(0, Math.min(size - 1, center[0] + Math.floor(rand(w) * 7) - 3));
    const y =
      config.spawn === 'uniform'
        ? Math.floor(rand(w) * size)
        : Math.max(0, Math.min(size - 1, center[1] + Math.floor(rand(w) * 7) - 3));
    const t = tileAt(w, x, y);
    t.terrain = 'plain';
    t.resources.food = 6;
    t.resources.wood = Math.max(8, t.resources.wood ?? 0);
    const a = makeAgent(w, x, y);
    a.ap = 3;
    w.agents.push(a);
  }
  const sexes: ('F' | 'M')[] = w.agents.map((_, i) =>
    i < Math.ceil(config.population / 2) ? 'F' : 'M',
  );
  for (let i = sexes.length - 1; i > 0; i--) {
    const j = Math.floor(rand(w) * (i + 1));
    [sexes[i], sexes[j]] = [sexes[j], sexes[i]];
  }
  w.agents.forEach((a, i) => (a.sex = sexes[i] as 'F' | 'M'));
  w.cursor.ids = w.agents.map((a) => a.id);
  return w;
}
export function hashWorld(w: World) {
  let h = 2166136261;
  const s = JSON.stringify(w);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
