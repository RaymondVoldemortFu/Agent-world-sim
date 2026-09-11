import { CRAFTS } from './catalog';
import type { World, Config } from '../sim/types';
import type { ManorSettings, ManorTile } from './types';
import { batch } from '../ecology/batches';
import { BUILDINGS, ITEMS } from '../ecology/catalog';
export const RATION_KG = 2500 / ITEMS.grain.kcal;
export const MANOR_DEFAULTS: ManorSettings = {
  taxRate: 0.5,
  royalTax: 450,
  shockDay: 40,
  yieldMultiplier: 0.5,
  graceDays: 7,
  armySize: 10,
};
export const MANOR_CONFIG: Partial<Config> = {
  worldModel: 'ecology',
  controller: 'hybrid',
  ecoPreset: 'manor',
  size: 24,
  population: 31,
  regions: 1,
  days: 150,
  wildlifeEnabled: false,
  startDay: 90,
  inventoryCapacity: 30,
  dailyAP: 5,
  manorSettings: MANOR_DEFAULTS,
};
export function initManor(w: World) {
  w.rulesVersion = 'manor-1.0.0';
  w.ecology!.regionNames = ['鸦溪领地'];
  const settings = { ...MANOR_DEFAULTS, ...w.config.manorSettings };
  w.manor = {
    version: 1,
    settings,
    plaza: [9, 10],
    exit: [0, 10],
    manor: [18, 7],
    shock: false,
    warrantSubject: w.agents[0].id,
    king: { dueDay: 35, received: 0, totalReceived: 0, arrears: 0, phase: 'collecting' },
    missions: [],
    treasury: [],
    accounts: [],
    history: [],
    harvests: [],
  };
  const at = (x: number, y: number) => w.tiles[y * w.config.size + x];
  const site = (x: number, y: number, kind: ManorTile['kind'], label?: string) => {
    at(x, y).manor = { kind, label };
    return at(x, y);
  };
  for (const t of w.tiles) {
    t.manor = { kind: 'green' };
    t.terrain = 'plain';
    Object.assign(t.eco!, {
      biome: 'meadow',
      area: 0.0225,
      slope: 0,
      biomass: {},
      capacity: {},
      deposits: [],
      ground: [],
      fields: [],
      structures: [],
      herds: [],
      improvements: {},
      surfaceWater: 0,
      contamination: 0,
    });
  }
  for (let x = 0; x < 22; x++) {
    site(x, 10, 'road');
    at(x, 10).eco!.improvements.road = 1;
  }
  for (let y = 6; y <= 19; y++) for (const x of [4, 7, 10, 14]) site(x, y, 'road');
  for (let x = 8; x <= 11; x++) for (let y = 10; y <= 11; y++) site(x, y, 'plaza', '集会广场');
  site(9, 11, 'well', '公共井');
  at(9, 11).eco!.surfaceWater = 100000;
  const storage = (x: number, y: number, id: string, grain: number) => {
    at(x, y).eco!.structures.push({
      id,
      kind: 'granary',
      progress: BUILDINGS.granary.minutes,
      condition: 1,
      contents: grain ? [batch('grain', grain, w.tick, id + '-grain', '初始储粮')] : [],
    });
  };
  for (let x = 15; x <= 21; x++)
    for (let y = 3; y <= 11; y++) {
      if (x === 15 || x === 21 || y === 3 || y === 11) site(x, y, 'wall', '庄园石墙');
    }
  site(15, 10, 'gate', '庄园门').manor!.lock = { key: 'key_keep', locked: true, hp: 240 };
  site(18, 7, 'keep', '庄园大厅（内设粮仓）').manor!.lock = {
    key: 'key_keep',
    locked: true,
    hp: 120,
  };
  storage(18, 7, 'keep-store', 7 * 35 * RATION_KG);
  site(12, 12, 'smithy', '铁匠工棚');
  storage(12, 12, 'workshop', 0);
  const workshop = at(12, 12).eco!.structures[0].contents;
  for (const [item, kg] of Object.entries({
    iron: 100,
    wood: 200,
    leather: 60,
    cord: 20,
    wood_tablet: 15,
  }))
    workshop.push(batch(item, kg, 1, 'workshop-' + item, '初始工坊材料'));
  at(9, 10).eco!.structures.push({
    id: 'plaza-board',
    kind: 'noticeboard',
    condition: 1,
    progress: BUILDINGS.noticeboard.minutes,
    contents: [
      batch('wood_tablet', 15, 1, 'board-blanks', '告示板备用木板'),
      batch('iron_knife', 0.5, 1, 'board-knife', '公用刻刀'),
    ],
  });
  const homes: [number, number][] = [
    [5, 8],
    [8, 8],
    [11, 8],
    [5, 13],
    [8, 13],
    [11, 13],
  ];
  const familyNames = ['麦田', '磨坊', '榆树', '河湾', '石桥', '牧钟'];
  const identities = [
    '领主埃德蒙',
    '武装随从罗兰',
    '武装随从雨果',
    '武装随从玛拉',
    '武装随从奥托',
    '武装随从艾达',
    '村长马丁',
  ];
  for (let h = 0; h < 6; h++) {
    const [x, y] = homes[h];
    site(x, y, 'house', familyNames[h] + '家');
    at(x, y).manor!.lock = { key: `key_home${h + 1}`, locked: true, hp: 60 };
    storage(x, y, `home-${h + 1}`, 4 * 35 * RATION_KG);
    for (let p = 0; p < 8; p++) {
      const n = h * 8 + p,
        px = 2 + (n % 12),
        py = 16 + Math.floor(n / 12);
      site(px, py, 'field', `${familyNames[h]}田${p + 1}`).manor!.plot = {
        id: `plot-${n + 1}`,
        work: 0,
        required: 1800,
        yieldKg: (1800 * RATION_KG) / 48,
        harvest: 0,
        month: 1,
      };
    }
  }
  const titles = w.agents
    .map(
      (a, i) =>
        `${i < 7 ? identities[i] : familyNames[Math.floor((i - 7) / 4)] + ['·父', '·母', '·长子', '·长女'][(i - 7) % 4]} #${a.id}`,
    )
    .join('；');
  for (const [i, a] of w.agents.entries()) {
    delete a.role;
    a.recipes = [];
    a.name =
      i < 7
        ? identities[i].replace('领主', '').replace('武装随从', '').replace('村长', '')
        : familyNames[Math.floor((i - 7) / 4)] + ['·父', '·母', '·长子', '·长女'][(i - 7) % 4];
    const h = Math.floor((i - 7) / 4),
      home: [number, number] = i < 6 ? [18, 7] : i === 6 ? [9, 10] : homes[h];
    a.x = home[0];
    a.y = home[1];
    a.ap = w.config.dailyAP;
    a.eco!.stock = [];
    a.eco!.knowledge = ['manor_farming', ...Object.keys(CRAFTS)];
    const key = i < 6 ? 'key_keep' : i === 6 ? '' : `key_home${h + 1}`;
    if (key) a.eco!.stock.push(batch(key, 0.05, 1, `key-${a.id}`, '随身钥匙'));
    if (i < 6)
      for (const [item, kg] of Object.entries({ iron_sword: 1.4, mail: 6, wooden_shield: 2.5 }))
        a.eco!.stock.push(batch(item, kg, 1, `equipment-${a.id}-${item}`, '初始装备'));
    if (i >= 7) a.eco!.stock.push(batch('iron_sickle', 0.85, 1, `sickle-${a.id}`, '初始农具'));
    a.eco!.stock.push(
      batch(
        'grain',
        i === 0 ? Math.min(10 * RATION_KG, w.config.inventoryCapacity - 10.95) : 2 * RATION_KG,
        1,
        `ration-${a.id}`,
        '随身口粮',
      ),
    );
    if (i === 0 || i === 6)
      a.eco!.stock.push({
        ...batch('personal_ledger', 1, 1, `ledger-${a.id}`, '初始个人账簿'),
        pages: [],
      });
    const plots =
      i >= 7
        ? [`plot-${h * 8 + ((i - 7) % 4) * 2 + 1}`, `plot-${h * 8 + ((i - 7) % 4) * 2 + 2}`]
        : [];
    const motive =
      i === 0
        ? '你被承认为领主。你珍视统治权、家族威望和储粮，担心失去武装随从与国王信任。你应当在粮食成熟并实际收获后再向农户收税，每月第30天作物成熟，需留出收割与运粮时间；不要提前抽走农户赖以度日的存粮。惯例由村长收齐农户粮税再交给你；你需供养随从并向国王缴粮。王室税到期必须缴足，不存在宽限、减免或延期，任何领地因素都不能作为欠税理由。你的日常食物在庄园粮仓 keep-store，位于庄园大厅(18,7)内部；你和随从在大厅当值时可原地取粮；你身上持有 key_keep 钥匙，可以亲自前往取粮，不必等村长送饭。你初始已携带额外谷物口粮，可直接吃。饥饿时可下达 estate withdraw，id=keep-store，item=grain，quantity=3；会自动走到粮仓取粮，初始日程会自动吃随身粮；你需主动设置取粮等其他自动任务，重设 dailyRoutine 时请保留 eat:true。庄园粮仓缺粮是非常危险的，会让你和随从断粮甚至饿死。你需要尽可能保证 keep-store 里始终有足够的实际粮食，把维持生存储备作为持续关注的重要事务：每日检查庄园粮仓库存、你与随从的随身口粮和自己的饱食度，估算现有储粮还能支撑多少天，以及能否撑到下一次粮食实际入仓；发现储备不足就优先安排补仓和领取口粮，不要等粮仓空了或已经挨饿才行动。田里尚未收获的粮食、农户家粮、公共仓粮和别人承诺上缴的粮食都不等于庄园粮仓已有的粮食，必须实际运入 keep-store 才算补仓；粮仓有粮也不会自动进入你的背包，你仍需取到随身才能吃。粮仓用于你与五名武装随从的日常饮食，每人每天约消耗0.7353kg，六人合计约4.41kg；库存下降是正常生活开销，不等于偷窃或失职。应结合收成、交付记录和实际口粮天数判断，不要为了账面库存拒绝自己或随从正常进食。'
        : i < 6
          ? '你是领主供养的职业武装随从。庄园粮仓 keep-store 就在大厅(18,7)内，你持有 key_keep，可在大厅原地用 estate withdraw 取粮，别等领主逐人送饭；保持随身有多日口粮。你的装备与地位值得维护；忠诚、同伴安危和能否拿到口粮影响你的选择。'
          : i === 6
            ? '你被村民承认为村长。惯例由你向各户收粮，再搬运交给领主。你靠领主供养但熟悉村民，承受双方压力；你也可以少报、谈判或拒绝。'
            : `你是${familyNames[h]}家的农民。家人是 #${w.agents[7 + h * 4].id}、#${w.agents[8 + h * 4].id}、#${w.agents[9 + h * 4].id}、#${w.agents[10 + h * 4].id}，亲属共享家庭储藏钥匙。你尤其关心家人能否活下去。与${familyNames[(h + 1) % 6]}家有互助交情，与${familyNames[(h + 3) % 6]}家有旧田界纠纷。你从小耕种指定田条。`;
    a.residence = {
      reserveDays: i === 0 ? 10 : 2,
      home,
      store: i < 7 ? 'keep-store' : `home-${h + 1}`,
      plots,
      keys: key ? [key] : [],
      biography: `${motive}${i === 0 || i === 6 ? `你随身带着个人账簿 ledger-${a.id}，可用 estate write_ledger 记录实际收支、欠款和约定，并用 estate show_ledger 向指定人物展示；账目由你自行书写，应区分已完成的收支与承诺，系统不会自动替你记账。` : ''}\n熟知居民：${titles}。\n领地惯例：收成的${settings.taxRate * 100}%由村长 #${w.agents[6].id}收取并交给领主 #${w.agents[0].id}；每30天王室索取${settings.royalTax}人日粮，首次期限第35天。1人日粮=${RATION_KG.toFixed(4)}kg谷物。以上是人的身份认知与税收要求，不保证别人服从。`,
    };
    // Personal starting dispositions, never consulted by physics or access checks.
    if (i === 0) a.personality = [0.35, 0.8, 0.7, 0.15, 0.55];
    else if (i < 6) a.personality = [0.4, 0.65, 0.6, 0.25, 0.4];
    if (i >= 7 && (i - 7) % 4 >= 2) a.parents = [w.agents[7 + h * 4].id, w.agents[8 + h * 4].id];
    if (i >= 7) {
      a.sex = (i - 7) % 2 ? 'F' : 'M';
      a.age = ((i - 7) % 4 < 2 ? 43 : 21) * 365;
    }
    a.brain!.combatPolicy = { mode: 'low_hp', retreatHp: 45 };
  }
  // The reeve receives an unlocked personal chest, not special access to the lord's stores.
  storage(9, 10, 'reeve-chest', 35 * RATION_KG);
  w.agents[6].residence!.store = 'reeve-chest';
  // Remove his allocation from the seven-person manor reserve to conserve initial food.
  at(18, 7).eco!.structures[0].contents[0].kg -= 35 * RATION_KG;
}
