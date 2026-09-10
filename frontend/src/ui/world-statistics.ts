import type { World } from '../sim/types';
import { metrics } from '../sim/engine';
import { ITEMS, BUILDINGS } from '../ecology/catalog';
import type { Batch } from '../ecology/types';
import { energy } from '../ecology/batches';

export const number = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
export const goalNames: Record<string, string> = {
  secure_food: '储备口粮',
  make: '制造',
  build: '建造',
  farm: '农耕',
  deliver: '交付物资',
  meet: '会面',
  reproduce: '繁衍',
  explore: '探索',
  navigate: '坐标导航',
  improve: '改造土地',
  herd: '照料畜群',
  hunt: '狩猎',
  survey: '全力观察',
  learn: '学习',
  repair: '维修',
  confront: '冲突',
};
export function worldStatistics(w: World) {
  const alive = w.agents.filter((a) => !a.death);
  const current = metrics(w);
  const mean = (fn: (a: (typeof alive)[number]) => number) =>
    alive.length ? alive.reduce((sum, a) => sum + fn(a), 0) / alive.length : null;
  const resourceMap = new Map<
    string,
    {
      id: string;
      name: string;
      natural: number;
      bag: number;
      ground: number;
      stored: number;
      processing: number;
    }
  >();
  const add = (
    id: string,
    where: 'natural' | 'bag' | 'ground' | 'stored' | 'processing',
    kg: number,
  ) => {
    if (kg <= 0) return;
    const row = resourceMap.get(id) ?? {
      id,
      name: ITEMS[id]?.name ?? { game: '野生猎物' }[id] ?? id,
      natural: 0,
      bag: 0,
      ground: 0,
      stored: 0,
      processing: 0,
    };
    row[where] += kg;
    resourceMap.set(id, row);
  };
  const stock = (batches: Batch[], where: 'bag' | 'ground' | 'stored' | 'processing') =>
    batches.forEach((b) => add(b.item, where, b.kg));
  for (const a of alive) if (a.eco) stock(a.eco.stock, 'bag');
  for (const t of w.tiles)
    if (t.eco) {
      Object.entries(t.eco.biomass).forEach(([id, kg]) => add(id, 'natural', kg));
      t.eco.deposits.forEach((d) => add(d.item, 'natural', d.kg));
      stock(t.eco.ground, 'ground');
      t.eco.structures.forEach((s) => stock(s.contents, 'stored'));
    }
  for (const j of w.ecology?.jobs ?? []) stock(j.inputs, 'processing');
  const fields = w.tiles.flatMap((t) => t.eco?.fields ?? []);
  const structures = w.tiles.flatMap((t) => t.eco?.structures ?? []);
  const batches = [
    ...alive.flatMap((a) => a.eco?.stock ?? []),
    ...w.tiles.flatMap((t) => [
      ...(t.eco?.ground ?? []),
      ...(t.eco?.structures.flatMap((s) => s.contents) ?? []),
    ]),
  ];
  const riskyFD = energy(batches.filter((b) => b.risk >= 0.5)) / 2500;
  return {
    current,
    alive,
    averageHP: mean((a) => a.hp),
    averageHunger: mean((a) => a.hunger),
    averageLoneliness: mean((a) => a.social?.loneliness ?? 0),
    critical: alive.filter((a) => a.hp < 35).length,
    hungry: alive.filter((a) => a.hunger <= 40).length,
    depressed: alive.filter((a) => a.social?.depressed).length,
    pregnancies: alive.filter((a) => a.pregnancy).length,
    resources: [...resourceMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    fields,
    structures,
    riskyFD,
    completedBuildings: structures.filter(
      (s) => s.progress >= (BUILDINGS[s.kind]?.minutes ?? Infinity),
    ).length,
    chart: w.metrics.map((m, i) => ({
      ...m,
      dailyChats: m.chats - (w.metrics[i - 1]?.chats ?? 0),
      dailyCalls: m.calls - (w.metrics[i - 1]?.calls ?? 0),
    })),
  };
}
