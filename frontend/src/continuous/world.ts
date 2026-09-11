import { DAY, RATION, TILE, type World, type Site } from './types';
import { ContinuousConfigSchema, type ContinuousConfig } from './config';

export function createContinuousWorld(
  id: string,
  mode: World['mode'] = 'scripted',
  days = 150,
  options: Partial<ContinuousConfig> = {},
): World {
  const settings = ContinuousConfigSchema.parse({ days, ...options });
  const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  const sites: Site[] = [
    { id: 'hall', label: '橡木大厅 · 内设粮仓', kind: 'hall', ...at(14, 3) },
    { id: 'home-west', label: '河岸人家', kind: 'home', ...at(4, 5) },
    { id: 'home-south', label: '麦田人家', kind: 'home', ...at(5, 11) },
    { id: 'plaza', label: '榆树广场', kind: 'plaza', ...at(8, 8) },
    { id: 'well', label: '公共水井', kind: 'well', ...at(7, 8) },
    { id: 'workshop', label: '木石工棚', kind: 'workshop', ...at(4, 8) },
    { id: 'gate', label: '庄园门', kind: 'gate', ...at(12, 5) },
  ];
  const fields = Array.from({ length: 8 }, (_, i) => ({
    id: `field-${i + 1}`,
    label: `麦田 ${i + 1}`,
    ...at(9 + (i % 4), 11 + Math.floor(i / 4)),
    work: 0,
    required: 30 * 4 * 60 * 60000,
    harvest: 0,
  }));
  for (const f of fields) sites.push({ ...f, kind: 'field' });
  const walls = [];
  for (let x = 12; x <= 16; x++)
    for (let y = 1; y <= 6; y++)
      if ((x === 12 || x === 16 || y === 1 || y === 6) && !(x === 12 && y === 5))
        walls.push(at(x, y));
  const roadKeys = new Map<string, { x: number; y: number }>();
  const road = (x: number, y: number) => roadKeys.set(`${x}:${y}`, at(x, y));
  for (let x = 0; x <= 14; x++) road(x, 8);
  for (let y = 3; y <= 12; y++) {
    road(6, y);
    road(11, y);
  }
  for (let x = 4; x <= 14; x++) road(x, 5);
  for (let y = 3; y <= 5; y++) road(14, y);
  for (let x = 4; x <= 6; x++) road(x, 11);
  const names = ['艾琳', '罗兰', '玛莎', '托马斯', '伊莎贝尔'];
  const colors = [0xce8852, 0x547d96, 0x8e6797, 0x79884e, 0xc4a252];
  const agents = names.map((name, i) => ({
    id: i + 1,
    name,
    color: colors[i],
    sex: (i === 1 || i === 3 ? 'M' : 'F') as 'M' | 'F',
    personality: [
      [0.8, 0.7, 0.8, 0.5, 0.2],
      [0.3, 0.9, 0.3, 0.4, 0.6],
      [0.6, 0.8, 0.7, 0.9, 0.4],
      [0.2, 0.4, 0.8, 0.2, 0.7],
      [0.9, 0.6, 0.4, 0.7, 0.3],
    ][i],
    biography: `你是榆树村居民。熟知艾琳#1、罗兰#2、玛莎#3、托马斯#4、伊莎贝尔#5。你的家庭储藏为${i < 2 ? 'home-west' : 'home-south'}；熟悉田条 field-${i + 1}。家庭储粮可由同住者领取。${i === 1 ? '你随身持有庄园门钥匙，可以通过庄园门到大厅领取粮食。' : '庄园门锁住时需要开门或持有钥匙才能通过。'}你自行决定分工、合作和承诺；不要把说过的话当作已完成的工作。`,
    home: i < 2 ? 'home-west' : 'home-south',
    plot: `field-${i + 1}`,
    keys: i === 1 ? ['manor-key'] : [],
    ...at(7 + (i % 3), 7 + Math.floor(i / 3)),
    hp: 100,
    food: 3600 - i * 200,
    bodyAt: 0,
    grain: 2 * RATION,
    capacity: settings.inventoryCapacity,
    dead: false,
    planVersion: 0,
    intent: mode === 'scripted' ? '按演示安排体验村庄生活' : '观察村庄，安排自己的日常任务',
    routine: {
      eat: true,
      fetch: mode === 'scripted',
      reserveDays: 7,
      work: mode === 'scripted' && i !== 1,
    },
    task:
      mode === 'scripted'
        ? {
            kind: (i === 1 ? 'supply' : 'farm') as 'supply' | 'farm',
            target: i === 1 ? 'hall' : `field-${i + 1}`,
            amount: i === 1 ? 7 * RATION : 5,
          }
        : undefined,
    nextThink: 0,
    lastRead: 0,
    thoughts: 0,
    tokens: 0,
    stats: { workMs: 0, distance: 0, eatenKg: 0, spoken: 0, deliveredKg: 0 },
  }));
  const stores = ['hall', 'home-west', 'home-south'].map((id, i) => ({
    ...sites.find((s) => s.id === id)!,
    grain: [120, 70, 105][i] * RATION,
    reserved: 0,
  }));
  return {
    version: 'continuous-prototype-1',
    id,
    time: 0,
    seq: 0,
    status: 'running',
    mode,
    days: settings.days,
    settings,
    size: { w: 18, h: 16 },
    sites,
    walls,
    roads: [...roadKeys.values()],
    agents,
    stores,
    fields,
    gates: [{ ...sites.find((s) => s.id === 'gate')!, open: true, key: 'manor-key' }],
    resourceVersion: 0,
    nextBody: 30 * 60000,
    nextDay: DAY,
    ledger: {
      initial: stores.reduce((n, s) => n + s.grain, 0) + agents.reduce((n, a) => n + a.grain, 0),
      grown: 0,
      eaten: 0,
    },
    calls: 0,
    maxCalls: settings.maxCalls,
  };
}
