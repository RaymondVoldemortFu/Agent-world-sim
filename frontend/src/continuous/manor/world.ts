import { initializeHousehold, TAX_OFFICER, STEWARD, HOUSEHOLD } from './identity';
import { createWorld } from '../../sim/world';
import { MANOR_CONFIG } from '../../manor/world';
import { createContinuousWorld } from '../world';
import { DAY, TILE, type World, type Agent, type Site } from '../types';
import type { ContinuousConfig } from '../config';

/** Reuse the discrete experiment's authoritative map, biography and physical endowments. */
export function createManorWorld(
  id: string,
  mode: World['mode'],
  config: Partial<ContinuousConfig> = {},
): World {
  const w = createContinuousWorld(id, mode, config.days ?? 150, { ...config, scenario: 'manor' });
  w.settings!.scenario = 'manor';
  const { taxRate, royalTax, shockDay, yieldMultiplier, graceDays, armySize } = w.settings!;
  const manorSettings = { taxRate, royalTax, shockDay, yieldMultiplier, graceDays, armySize };
  if (w.settings!.inventoryCapacity < 20) throw Error('领地开局装备需要至少20kg背包容量');
  const legacy = createWorld(
    {
      ...MANOR_CONFIG,
      inventoryCapacity: Math.max(20, w.settings!.inventoryCapacity),
      manorSettings,
    },
    id + '-seed',
  );
  const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  w.version = 'continuous-game-2';
  w.size = { w: 24, h: 24 };
  w.sites = [];
  w.stores = [];
  w.fields = [];
  w.walls = [];
  w.roads = [];
  w.gates = [];
  for (const t of legacy.tiles) {
    const m = t.manor!,
      p = at(t.x, t.y);
    if (m.kind === 'wall') w.walls.push(p);
    if (['road', 'plaza'].includes(m.kind)) w.roads.push(p);
    if (m.kind === 'gate') {
      w.gates.push({
        id: 'gate',
        label: '庄园门',
        ...p,
        open: false,
        key: m.lock!.key,
        hp: m.lock!.hp,
      });
      w.sites.push({ id: 'gate', label: '庄园门', kind: 'gate', ...p });
    }
    if (m.plot) {
      const f = {
        id: m.plot.id,
        label: m.label!,
        ...p,
        work: 0,
        required: m.plot.required * 60000,
        harvest: 0,
        yieldKg: m.plot.yieldKg,
      };
      w.fields.push(f);
      w.sites.push({ ...f, kind: 'field' });
    }
    for (const s of t.eco!.structures) {
      if (s.id === 'plaza-board') continue;
      const kind: Site['kind'] =
        m.kind === 'keep'
          ? 'hall'
          : m.kind === 'house'
            ? 'home'
            : m.kind === 'smithy'
              ? 'workshop'
              : 'plaza';
      w.sites.push({ id: s.id, label: m.label ?? '村长粮箱', kind, ...p });
      w.stores.push({
        id: s.id,
        label: m.label ?? '村长粮箱',
        ...p,
        grain: s.contents.filter((b) => b.item === 'grain').reduce((n, b) => n + b.kg, 0),
        reserved: 0,
        items: Object.fromEntries(
          s.contents.filter((b) => b.item !== 'grain').map((b) => [b.item, b.kg]),
        ),
        lock: m.lock ? structuredClone(m.lock) : undefined,
      });
    }
  }
  w.sites.push(
    { id: 'plaza', label: '集会广场', kind: 'plaza', ...at(9, 10) },
    { id: 'well', label: '公共井', kind: 'well', ...at(9, 11) },
    { id: 'exit', label: '王室道路出口', kind: 'plaza', ...at(0, 10) },
    { id: 'plaza-board', label: '公共告示板', kind: 'plaza', ...at(9, 10) },
  );
  const base = w.agents[0];
  w.agents = legacy.agents.map((a, i): Agent => {
    const r = a.residence!,
      stock = a.eco!.stock;
    // Coordinates in inherited biographies are legacy tiles; runtime atlas is in meters.
    const biography =
      r.biography
        .replace(/estate withdraw/g, 'task supply')
        .replace(/id=keep-store，item=grain，quantity=3/g, 'target=keep-store，amount=5')
        .replace(/estate write_ledger/g, 'task write')
        .replace(/estate show_ledger/g, 'task show')
        .replace(/dailyRoutine/g, 'routine') +
      '\n上文括号中的坐标为旧地块坐标，实际导航使用地图中的地点ID与米坐标。supply 的 amount 是补足随身粮食到该kg数；账簿用 target=ledger-ID，show 用 target=agent:ID、item=ledger-ID。';
    return {
      ...structuredClone(base),
      id: a.id,
      name: a.name,
      sex: a.sex,
      personality: a.personality,
      color: [0x973e3c, 0x597a94, 0x85864c, 0xb28757, 0x8c6590, 0x737e72][i % 6],
      biography,
      home: r.store,
      plot: r.plots[0] ?? '',
      plots: r.plots,
      keys: [...r.keys],
      ...at(a.x, a.y),
      grain: stock.filter((b) => b.item === 'grain').reduce((n, b) => n + b.kg, 0),
      items: Object.fromEntries(
        stock
          .filter((b) => b.item !== 'grain' && !b.item.startsWith('key_'))
          .map((b) => [b.item, b.kg]),
      ),
      capacity: Math.max(20, w.settings!.inventoryCapacity),
      food: 5000,
      hp: 100,
      task: undefined,
      routine: { eat: true, fetch: false, reserveDays: 7, work: false },
      combat: { mode: 'low_hp', retreatHp: 45 },
      intent: '安排自己的生计、家庭与社会事务',
    };
  });
  w.manor = {
    settings: manorSettings,
    warrantSubject: w.agents[0].id,
    financeAgent: 32,
    taxAgent: TAX_OFFICER,
    stewardAgent: STEWARD,
    household: [...HOUSEHOLD],
    letters: [],
    king: { dueDay: 35, received: 0, totalReceived: 0, arrears: 0, phase: 'collecting' },
    missions: [],
    treasury: 0,
    inscriptions: [
      { id: 'plaza-board', site: 'plaza-board', pages: [], shared: {} },
      ...[1, 7].map((id) => ({ id: `ledger-${id}`, holder: id, pages: [], shared: {} })),
    ],
  };
  const tax = { id: 'royal-tax-store', label: '王税粮仓', kind: 'plaza' as const, ...at(19, 9) };
  w.sites.push(tax);
  w.stores.push({ ...tax, grain: 0, reserved: 0, items: {} });
  const finance: Agent = {
    ...structuredClone(w.agents[6]),
    id: 32,
    name: '财政官西蒙',
    color: 0x536e75,
    home: 'keep-store',
    keys: ['key_keep'],
    ...at(18, 7),
    grain: (7 * 2500) / 3400,
    items: { personal_ledger: 1 },
    biography:
      '你是领主埃德蒙 #1 任用的财政官西蒙 #32。协助领主核算庄园口粮、农业收成和王税，向领主与村长说明真实数字、提出可执行的收粮计划。你可直接读取引擎提供的财政报表：精确的按当前耕作进度可收产量、完工潜在产量、收获日期、王税待缴和欠款、庄园粮仓可维持天数。预测不是已经入仓的粮食。王税粮仓 royal-tax-store 独立于 keep-store，到期自动扣税；不能延期减免。你持有庄园钥匙，口粮在 keep-store，主动取粮并配置日程。你带有账簿 ledger-32，可写账并向他人展示。',
  };
  w.agents.push(finance);
  w.manor.inscriptions.push({ id: 'ledger-32', holder: 32, pages: [], shared: {} });
  w.stores.find((s) => s.id === 'keep-store')!.grain += (35 * 2500) / 3400;
  const familyBackgrounds = new Map(
    legacy.agents
      .filter((a) => a.id >= 8)
      .map((a) => [a.id, a.residence!.biography.split('\n熟知居民')[0]]),
  );
  for (const id of ['reeve-chest', 'keep-store', 'royal-tax-store']) {
    const store = w.stores.find((s) => s.id === id)!;
    store.lock ??= {
      key: id === 'reeve-chest' ? 'key_village' : 'key_keep',
      locked: false,
      hp: 120,
    };
    store.lock.locked = false;
  }
  w.stores.find((s) => s.id === 'reeve-chest')!.label = '村庄粮仓';
  w.sites.find((s) => s.id === 'reeve-chest')!.label = '村庄粮仓';
  w.agents.find((a) => a.id === 1)!.keys.push('key_village');
  const taxOfficer = w.agents.find((a) => a.id === TAX_OFFICER)!;
  taxOfficer.keys.push('key_village');
  taxOfficer.items!.horse_cart = 1;
  w.stores.find((s) => s.id === 'workshop')!.items!.horse_cart = 2;
  initializeHousehold(w, familyBackgrounds);
  for (const a of w.agents) {
    const peers = w.agents.filter((b) => b.home === a.home),
      i = peers.findIndex((b) => b.id === a.id);
    a.x += ((i % 3) - 1) * 1.5;
    a.y += (Math.floor(i / 3) - 1) * 1.5;
  }
  w.ledger = {
    initial: w.stores.reduce((n, s) => n + s.grain, 0) + w.agents.reduce((n, a) => n + a.grain, 0),
    grown: 0,
    eaten: 0,
  };
  w.nextDay = DAY;
  return w;
}
