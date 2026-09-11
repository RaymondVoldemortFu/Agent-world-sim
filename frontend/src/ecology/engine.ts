import { actionConditions } from '../manor/execution';
import { SHOUT_RADIUS } from '../sim/world';
import {
  CRAFTS,
  observeRoyalMission,
  executeManor,
  manorView,
  settleManor,
  validateManorAction,
  canEnter,
} from '../manor/engine';
import {
  inscribe,
  visibleInscriptions,
  readInscriptions,
  concealLedgerPages,
} from './inscriptions';
import { advanceWildlife, fightBeast, fleeCombat, settlements, combatView } from './wildlife';
import type { World, Agent, Decision, WorldEvent, Metrics, Action } from '../sim/types';
import { ActionSchema } from '../sim/types';
import type { EcoAction, EcoObservation, ScheduledAction } from './types';
import { Tx } from '../sim/transaction';
import { ITEMS, RECIPES, BUILDINGS, CROPS } from './catalog';
import {
  batch,
  put,
  take,
  mass,
  quantity,
  energy,
  capacity,
  requireInputs,
  consume,
  capability,
  wear,
} from './batches';
import { ecoAt } from './world';
import { finishJobs, settleEcology, dieEco } from './environment';
import { recordSpeaking, lonelinessCapacity } from '../sim/social';
const ensure = (condition: unknown, text: string) => {
  if (!condition) throw Error(text);
};
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export function ecoId(w: World, a: Agent) {
  return `${w.id}:${w.tick}:eco:${a.eco!.readyAt}:${a.id}:${a.eco!.serial ?? 0}`;
}
export function readyActors(w: World) {
  return w.agents
    .filter(
      (a) =>
        !a.death && !a.away && a.ap > 1e-7 && !w.ecology!.pending.some((p) => p.actor === a.id),
    )
    .sort((a, b) => a.eco!.readyAt - b.eco!.readyAt || a.id - b.id);
}
export function nextEco(w: World) {
  if (w.cursor.phase === 'complete') return null;
  const a = readyActors(w)[0],
    p = [...w.ecology!.pending].sort((a, b) => a.at - b.at || a.actor - b.actor)[0];
  if (!a || (p && p.at <= a.eco!.readyAt)) return null;
  return { kind: 'action' as const, agent: a, id: ecoId(w, a) };
}
export function minutesFor(w: World, a: Agent, action: Action) {
  if (action.type === 'manor')
    return action.op === 'write_ledger'
      ? 60
      : action.op === 'show_ledger'
        ? 24
        : action.op === 'craft'
          ? (CRAFTS[action.recipe ?? '']?.minutes ?? 120)
          : ['give', 'deposit', 'withdraw', 'tribute', 'lock', 'unlock'].includes(action.op)
            ? 12
            : 120;
  if (action.type === 'move') {
    const t = ecoAt(w, a.x, a.y, a.eco!.region).eco!;
    return Math.ceil(
      (6 * (1 + t.slope * 2 + mass(a.eco!.stock) / 30)) / (1 + (t.improvements.road ?? 0) * 0.3),
    );
  }
  if (action.type === 'survey' || action.type === 'shout') return 240;
  if (action.type === 'chat' || action.type === 'public_speak') return 24;
  if (action.type === 'reproduce') return 120;
  if (action.type === 'wait') return Math.min(120, a.ap * 120);
  if (action.type !== 'eco') return 120;
  if (action.op === 'inscribe') return action.item === 'stone_tablet' ? 120 : 60;
  switch (action.op) {
    case 'discard':
      return 0;
    case 'eat':
    case 'drink':
      return 12;
    case 'transfer':
    case 'water':
      return 12;
    case 'start_job':
      return 12;
    case 'cancel_job':
      return 6;
    case 'work_job':
      return Math.min(
        120,
        Math.max(
          1,
          (RECIPES[w.ecology!.jobs.find((j) => j.id === action.id)?.recipe ?? '']?.minutes ?? 120) -
            (w.ecology!.jobs.find((j) => j.id === action.id)?.work ?? 0),
        ),
      );
    case 'travel':
      return 360;
    case 'study':
      return 120;
    default:
      return 120;
  }
}
export function startEco(w: World, agentId: number, d: Decision, id: string): WorldEvent {
  const a = w.agents.find((a) => a.id === agentId)!;
  ensure(a && !a.death, '角色不存在或死亡');
  ensure(!w.ecology!.pending.some((p) => p.actor === agentId), '角色仍在执行动作');
  const tx = new Tx(w);
  tx.a(a);
  if (a.role === 'prophet') a.personality[2] = 0.85;
  const e = w.ecology!;
  e.clock = Math.max(e.clock, a.eco!.readyAt);
  a.intent = d.intent.slice(0, 200);
  if (d.brainUpdate) {
    a.brain = structuredClone(d.brainUpdate.brain);
    if (d.brainUpdate.knowledge) a.eco!.knowledge = [...new Set(d.brainUpdate.knowledge)];
  }
  const source = a.brain!.source;
  if (source === 'llm') e.brainStats.llmDecisions++;
  else if (source === 'plan') e.brainStats.planActions++;
  else if (source === 'fallback') e.brainStats.fallbacks++;
  else e.brainStats.ruleActions++;
  let minutes = minutesFor(w, a, d.action);
  let error = '';
  try {
    ActionSchema.parse(d.action);
    ensure(a.ap * 120 + 1e-7 >= minutes, '今日剩余劳动时间不足');
  } catch (err) {
    error = String(err);
    minutes = Math.min(12, a.ap * 120);
  }
  a.ap = Math.max(0, a.ap - minutes / 120);
  a.eco!.readyAt = e.clock + minutes;
  a.eco!.serial = (a.eco!.serial ?? 0) + 1;
  if (error) {
    a.brain!.failures++;
    a.brain!.lastFailure = error;
    if (w.manor)
      a.brain!.executionBlock = {
        signature: actionConditions(observeEco(w, a), d.action),
        reason: error,
      };
    w.counters.failures++;
    tx.tell(a, error, 'observed', undefined, 5);
    return tx.finish('action_failed', error, id, false, a);
  }
  if (minutes === 0) w.cursor.freeActions = 1;
  e.pending.push({
    id,
    actor: a.id,
    at: a.eco!.readyAt,
    decision: {
      intent: d.intent,
      action: structuredClone(d.action),
      ...(d.memory_note ? { memory_note: d.memory_note } : {}),
    },
  });
  return tx.finish(
    'action_started',
    `${a.name} #${a.id} 开始 ${d.action.type === 'eco' ? d.action.op : d.action.type}（${minutes} 分钟）`,
    id,
    true,
    a,
  );
}
function complete(w: World, p: ScheduledAction) {
  const a = w.agents.find((a) => a.id === p.actor)!;
  const tx = new Tx(w);
  tx.a(a);
  const e = w.ecology!;
  e.clock = p.at;
  w.cursor.freeActions = 0;
  e.pending = e.pending.filter((j) => j.id !== p.id);
  const d = p.decision as Decision,
    action = d.action;
  let text = '',
    success = true,
    type: string = action.type === 'eco' ? action.op : action.type;
  const region = a.eco!.region;
  const t = ecoAt(w, a.x, a.y, region),
    tile = t.eco!,
    body = a.eco!,
    stores = [
      body.stock,
      tile.ground,
      ...tile.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
    ];
  let recipients: Agent[] = [];
  const touch = () => tx.t(a.x, a.y, region);
  const person = (id: number, range = 1) => {
    const b = w.agents.find((b) => b.id === id && !b.death && !b.away && !b.away && b.id !== a.id);
    ensure(b && b.eco!.region === region && distance(a, b) <= range, '目标必须是可及范围内的活人');
    return b!;
  };
  const addStock = (id: string, kg: number, source: string) => {
    ensure(
      mass(body.stock) + kg <= capacity(body.stock, w.config.inventoryCapacity) + 1e-6,
      '超过背包负重',
    );
    put(body.stock, [batch(id, kg, w.tick, `b-${e.nextId++}`, source)]);
  };
  try {
    ensure(!a.death, '角色已死亡');
    validateManorAction(w, a, action);
    switch (action.type) {
      case 'manor': {
        text = executeManor(w, tx, a, action);
        type = `estate_${action.op}`;
        break;
      }
      case 'move': {
        ensure(Math.abs(action.dx) + Math.abs(action.dy) === 1, '只能上下左右移动');
        const x = a.x + action.dx,
          y = a.y + action.dy;
        ensure(
          x >= 0 && y >= 0 && x < w.config.size && y < w.config.size,
          '不能跨越地图边界；跨区请 travel',
        );
        const dst = ecoAt(w, x, y, region).eco!;
        ensure(
          dst.biome !== 'water' ||
            capability(stores, 'boat') > 0 ||
            dst.structures.some(
              (s) =>
                s.kind === 'bridge' && s.progress >= BUILDINGS.bridge.minutes && s.condition > 0.4,
            ),
          '深水需要舟筏或桥',
        );
        if (a.brain!.navigation?.status === 'arrived') delete a.brain!.navigation;
        a.x = x;
        a.y = y;
        text = `移动到区域${region} (${x},${y})`;
        if (
          a.brain!.goal?.skill === 'navigate' &&
          a.brain!.goal.x === x &&
          a.brain!.goal.y === y &&
          (a.brain!.goal.region === undefined || a.brain!.goal.region === region)
        ) {
          delete a.brain!.goal;
          a.brain!.navigation = { status: 'arrived', steps: 0, destination: [x, y], day: w.tick };
          if (w.manor) {
            a.brain!.movement ??= {};
            a.brain!.movement.holdUntil =
              (w.tick - 1) * w.config.dailyAP * 120 + w.ecology!.clock + 600;
          }
          text += '，已到达导航目的地';
        }
        break;
      }
      case 'wait':
        text = '休息并等待';
        break;
      case 'survey': {
        a.eco!.survey = observeEco(w, a, 3);
        text = '全力观察距离三格的地形、活人与尸体';
        break;
      }
      case 'chat':
      case 'public_speak':
      case 'shout': {
        const range = action.type === 'shout' ? SHOUT_RADIUS : 1;
        if (action.type === 'chat') {
          if (action.targetId) person(action.targetId);
          if (action.proposal) {
            const b = person(action.proposal.targetId);
            ensure(
              a.age >= w.config.adultAge && b.age >= w.config.adultAge && a.sex !== b.sex,
              '繁衍双方须成年异性',
            );
            ensure(
              !w.proposals.some(
                (p) =>
                  !p.completed &&
                  !p.revoked &&
                  w.tick < p.day + 3 &&
                  [p.from, p.to].includes(a.id) &&
                  [p.from, p.to].includes(b.id),
              ),
              '双方已有有效提案',
            );
            a.brain!.goal = { skill: 'reproduce', targetId: b.id, expires: w.tick + 2 };
            w.proposals.push({
              id: `p-${w.seq + 1}`,
              from: a.id,
              to: b.id,
              day: w.tick,
              accepted: false,
              revoked: false,
              attempts: {},
              completed: false,
            });
          }
          if (action.acceptProposalId) {
            const p = w.proposals.find((p) => p.id === action.acceptProposalId);
            ensure(
              p && p.to === a.id && !p.revoked && !p.completed && w.tick < p.day + 3,
              '无法接受此提案',
            );
            const b = person(p!.from);
            ensure(
              a.sex !== b.sex && a.age >= w.config.adultAge && b.age >= w.config.adultAge,
              '繁衍双方须成年异性',
            );
            p!.accepted = true;
          }
          if (action.revokeProposalId) {
            const p = w.proposals.find((p) => p.id === action.revokeProposalId);
            ensure(p && !p.completed && [p.from, p.to].includes(a.id), '无法撤回');
            p!.revoked = true;
          }
        }
        recipients = w.agents.filter(
          (b) => !b.death && !b.away && b.eco!.region === region && distance(a, b) <= range,
        );
        text = `${action.type === 'shout' ? '大声说' : action.type === 'public_speak' ? '公开说' : '说'}：“${action.text}”`;
        if (recipients.some((b) => b.id !== a.id)) {
          recordSpeaking(a, w.tick);
          a.brain!.lastTalk = w.tick;
        }
        w.counters.chats++;
        break;
      }
      case 'reproduce': {
        const p = w.proposals.find((p) => p.id === action.proposalId);
        ensure(
          p &&
            [p.from, p.to].includes(a.id) &&
            p.accepted &&
            !p.revoked &&
            !p.completed &&
            w.tick < p.day + 3,
          '繁衍需要有效且被明确接受的提案',
        );
        const b = person(p!.from === a.id ? p!.to : p!.from, 0);
        const f = a.sex === 'F' ? a : b;
        ensure(
          a.sex !== b.sex &&
            a.age >= w.config.adultAge &&
            b.age >= w.config.adultAge &&
            !f.pregnancy &&
            w.tick >= f.cooldownUntil &&
            a.hunger >= 60 &&
            b.hunger >= 60,
          '年龄、身体或妊娠条件不满足',
        );
        ensure(p!.attempts[a.id] !== w.tick, '今日已参与');
        p!.attempts[a.id] = w.tick;
        text = '已记录共同繁衍意愿，等待同伴参与';
        if (p!.attempts[b.id] === w.tick) {
          tx.a(b);
          p!.completed = true;
          f.pregnancy = { father: a.sex === 'M' ? a.id : b.id, due: w.tick + 280 };
          body.foodKcal -= 250;
          b.eco!.foodKcal -= 250;
          text = '共同繁衍成功，开始 280 天妊娠';
        }
        break;
      }
      case 'attack': {
        const b = person(action.targetId, 0);
        const threat = { x: a.x, y: a.y, region: a.eco!.region, id: a.id };
        const attempts = new Set<number>();
        const retreat = fleeCombat(w, tx, b, threat, attempts);
        if (retreat?.escaped) {
          text = `试图攻击 #${b.id}；${retreat.text}`;
          break;
        }
        tx.a(b);
        const attacker = combatView(a),
          defender = combatView(b);
        b.hp -= Math.ceil(
          Math.max(20, attacker.attack) *
            (1 - defender.protection) *
            (w.manor && tile && ['keep', 'wall'].includes(t.manor?.kind ?? '') ? 0.6 : 1),
        );
        w.counters.attacks++;
        if (b.hp <= 0) dieEco(w, tx, b, '攻击');
        text = `攻击 #${b.id}${retreat ? '；' + retreat.text : ''}`;
        if (!b.death) {
          const after = fleeCombat(w, tx, b, threat, attempts);
          if (after) text += '；' + after.text;
          if (w.manor && !after?.escaped && b.x === a.x && b.y === a.y) {
            a.hp -= Math.ceil(Math.max(12, defender.attack) * (1 - attacker.protection));
            tx.tell(b, `#${a.id} 攻击了你，你进行了自卫反击`, 'observed', a.id, 9);
            text += '；对方自卫反击';
            if (a.hp <= 0) dieEco(w, tx, a, '战斗反击');
          }
        }
        break;
      }
      case 'eco': {
        const op = action.op;
        switch (op) {
          case 'inscribe': {
            text = inscribe(w, tx, a, action.item!, action.text!);
            if (w.manor && a.brain!.goal?.skill === 'inscribe') delete a.brain!.goal;
            if (a.brain!.goal?.skill === 'inscribe') delete a.brain!.goal;
            break;
          }
          case 'fight_beast': {
            const beast = e.beasts?.find(
              (b) => b.id === action.item && b.hp > 0 && b.region === region,
            );
            ensure(beast && distance(a, beast) <= 1, '野兽必须在一格内且仍存活');
            ensure(a.age >= w.config.adultAge, '幼年不能主动迎战野兽');
            text = fightBeast(w, tx, beast!).join('；');
            break;
          }
          case 'collect': {
            const item = action.item!;
            ensure(
              a.age >= 8 * 365 || ['berries', 'nuts', 'roots'].includes(item),
              '幼儿不能执行重型采集',
            );
            ensure(ITEMS[item], '未知资源');
            const limit = action.amount ?? 2;
            let n = 0;
            touch();
            if (item === 'meat') {
              ensure(capability(stores, 'hunting') > 0, '狩猎需要矛或弓');
              const group = w.agents.filter(
                (b) =>
                  !b.death &&
                  b.eco!.region === region &&
                  distance(a, b) === 0 &&
                  capability([b.eco!.stock], 'hunting') > 0,
              ).length;
              n = Math.min(
                limit,
                (tile.biomass.game ?? 0) * 0.5,
                2 * capability(stores, 'hunting') * (1 + Math.min(2, group - 1) * 0.3),
              );
              ensure(n > 0, '未找到猎物');
              ensure(
                mass(body.stock) + n <= capacity(body.stock, w.config.inventoryCapacity),
                '超过负重',
              );
              tile.biomass.game -= n / 0.5;
              wear(stores, 'hunting', 120);
              put(tile.ground, [
                batch('bone', n * 0.2, w.tick, `bone-${e.nextId++}`, '狩猎分割'),
                batch('hide', n * 0.2, w.tick, `hide-${e.nextId++}`, '狩猎分割'),
                batch('fat', n * 0.1, w.tick, `fat-${e.nextId++}`, '狩猎分割'),
                batch('feather', n * 0.01, w.tick, `feather-${e.nextId++}`, '混合小猎物分割'),
              ]);
              e.ledger.wasteKg += n * 0.49;
            } else if ((tile.biomass[item] ?? 0) > 0) {
              const speed =
                item === 'fish'
                  ? 0.4 * (1 + capability(stores, 'fishing'))
                  : item === 'green_wood'
                    ? capability(stores, 'woodwork') * 8
                    : item === 'wood'
                      ? 8
                      : item === 'roots'
                        ? 2.5 * (1 + capability(stores, 'digging') * 0.5)
                        : item === 'berries'
                          ? 4
                          : item === 'nuts'
                            ? 2
                            : item === 'grain'
                              ? 1.6
                              : 5;
              ensure(speed > 0, '需要相应工具');
              n = Math.min(
                limit,
                tile.biomass[item],
                speed,
                capacity(body.stock, w.config.inventoryCapacity) - mass(body.stock),
              );
              ensure(n > 0, '背包已满');
              tile.biomass[item] -= n;
            } else {
              const dep = tile.deposits.find((d) => d.item === item && d.kg > 0);
              ensure(dep, '此地没有可采资源');
              if (item.endsWith('_ore'))
                ensure(capability(stores, 'hammer') > 0, '采矿需要锤击工具');
              n = Math.min(
                limit,
                dep!.kg,
                8 / (1 + dep!.depth),
                capacity(body.stock, w.config.inventoryCapacity) - mass(body.stock),
              );
              ensure(n > 0, '背包已满');
              dep!.kg -= n;
              dep!.depth += n / 10000;
            }
            addStock(item, n, '采集');
            e.ledger.gatheredKg += n;
            text = `采集 ${ITEMS[item].name} ${n.toFixed(2)} kg`;
            body.skills.foraging = (body.skills.foraging ?? 0) + 0.002;
            break;
          }
          case 'eat': {
            const item = action.item!;
            ensure((ITEMS[item]?.kcal ?? 0) > 0, '这不是食物');
            const n = Math.min(action.amount ?? 1, quantity(body.stock, item));
            ensure(n > 0, '手上没有这种食物');
            const b = take(body.stock, item, n);
            const kcal = energy(b);
            body.foodKcal = Math.min(7500, body.foodKcal + kcal);
            const risk = b.reduce((s, b) => s + b.risk * b.kg, 0) / n;
            body.sickness = Math.min(12, body.sickness + risk * 4);
            body.protein = Math.min(
              1,
              body.protein +
                (item.includes('meat') || item.includes('fish') || item === 'pulses' ? 0.2 : 0.01),
            );
            a.hunger = Math.min(100, body.foodKcal / 50);
            e.ledger.consumedKcal += kcal;
            text = `食用 ${n.toFixed(2)} kg ${ITEMS[item].name}，摄入 ${kcal.toFixed(0)} kcal，食物风险 ${risk.toFixed(2)}`;
            break;
          }
          case 'drink': {
            const n = Math.min(action.amount ?? 3, 6 - body.waterL);
            ensure(n > 0, '已喝足');
            if (quantity(body.stock, 'water') >= n) take(body.stock, 'water', n);
            else {
              ensure(tile.surfaceWater >= n, '此地水源不足');
              touch();
              tile.surfaceWater -= n;
              body.sickness = Math.min(12, body.sickness + tile.contamination);
            }
            body.waterL += n;
            text = `饮水 ${n.toFixed(1)} L`;
            break;
          }
          case 'water': {
            const n = Math.min(
              action.amount ?? 3,
              tile.surfaceWater,
              capacity(body.stock, w.config.inventoryCapacity) - mass(body.stock),
            );
            ensure(n > 0, '无法取水');
            touch();
            addStock('water', n, '取水');
            tile.surfaceWater -= n;
            text = `取水 ${n.toFixed(1)} L`;
            break;
          }
          case 'transfer': {
            touch();
            const n = action.amount ?? 1,
              item = action.item!;
            let from = body.stock,
              to = tile.ground;
            if (action.destination === 'bag') {
              from = action.id
                ? (tile.structures.find((s) => s.id === action.id)?.contents ?? [])
                : tile.ground;
              to = body.stock;
              ensure(
                mass(to) + n <=
                  capacity(
                    [
                      ...to,
                      ...from
                        .filter((b) => b.item === item)
                        .map((b) => ({ ...b, kg: Math.min(n, b.kg) })),
                    ],
                    w.config.inventoryCapacity,
                  ),
                '背包负重不足',
              );
              if (item === 'cart')
                ensure(
                  tile.herds.some((h) => h.species === 'cattle' && h.count > 0 && h.health > 50),
                  '牛车需要本地健康牛牵引',
                );
            }
            if (action.destination === 'storage') {
              const s = tile.structures.find(
                (s) =>
                  s.id === action.id &&
                  s.progress >= BUILDINGS[s.kind].minutes &&
                  s.condition > 0.2,
              );
              ensure(s && BUILDINGS[s.kind].storage > 0, '库房不可用');
              to = s!.contents;
              ensure(mass(to) + n <= BUILDINGS[s!.kind].storage, '仓储容量不足');
            }
            if (action.destination === 'person') {
              const b = person(action.targetId!, 0);
              tx.a(b);
              to = b.eco!.stock;
              ensure(mass(to) + n <= capacity(to, w.config.inventoryCapacity), '对方负重不足');
              w.counters.gifts++;
            }
            put(to, take(from, item, n));
            text = `转移 ${ITEMS[item]?.name} ${n.toFixed(2)} kg 至 ${action.destination}`;
            break;
          }
          case 'discard': {
            const b = take(body.stock, action.item!, action.amount ?? 1);
            e.ledger.wasteKg += mass(b);
            text = '销毁手上物品';
            break;
          }
          case 'start_job': {
            const r = RECIPES[action.recipe!];
            ensure(r && body.knowledge.includes(r.id), '尚未掌握此工艺');
            ensure(
              !r.capability || capability(stores, r.capability) > 0,
              `需要能力 ${r?.capability}`,
            );
            ensure(
              !r.facility ||
                tile.structures.some(
                  (s) =>
                    s.kind === r.facility &&
                    s.progress >= BUILDINGS[s.kind].minutes &&
                    s.condition > 0.3,
                ),
              `需要设施 ${r?.facility}`,
            );
            ensure(
              !r.facility ||
                !e.jobs.some(
                  (j) =>
                    j.region === region &&
                    j.x === a.x &&
                    j.y === a.y &&
                    !['complete', 'cancelled'].includes(j.state) &&
                    RECIPES[j.recipe].facility === r.facility,
                ),
              '设备正被其他工序占用',
            );
            requireInputs(stores, r.inputs);
            touch();
            const inputs = consume(stores, r.inputs);
            const id = `job-${e.nextId++}`;
            e.jobs.push({
              id,
              recipe: r.id,
              region,
              x: a.x,
              y: a.y,
              started: w.tick,
              readyDay: w.tick + r.days,
              work: 0,
              inputs,
              operators: [a.id],
              state: 'working',
              quality: 1,
              lastTended: w.tick,
            });
            text = `启动 ${r.name} ${id}；投入已独立保管`;
            break;
          }
          case 'work_job': {
            const j = e.jobs.find(
              (j) =>
                j.id === action.id &&
                j.region === region &&
                j.x === a.x &&
                j.y === a.y &&
                !['complete', 'cancelled'].includes(j.state),
            );
            ensure(j, '此地没有进行中的工序');
            const r = RECIPES[j!.recipe];
            ensure(
              !r.capability || capability(stores, r.capability) > 0,
              `需要 ${r.capability} 工具`,
            );
            touch();
            const labor = minutesFor(w, a, action);
            j!.work = Math.min(
              r.minutes,
              j!.work + labor * (1 + Math.min(0.33, body.skills[r.skill] ?? 0)),
            );
            j!.lastTended = w.tick;
            if (!j!.operators.includes(a.id)) j!.operators.push(a.id);
            j!.state = j!.work >= r.minutes ? 'waiting' : 'working';
            body.skills[r.skill] = (body.skills[r.skill] ?? 0) + labor / 60000;
            if (r.capability) wear(stores, r.capability, labor);
            text = `参与 ${r.name} ${j!.id}，劳动 ${j!.work.toFixed(0)}/${r.minutes} 分钟`;
            finishJobs(w, tx);
            break;
          }
          case 'cancel_job': {
            const j = e.jobs.find(
              (j) =>
                j.id === action.id &&
                j.region === region &&
                j.x === a.x &&
                j.y === a.y &&
                !['complete', 'cancelled'].includes(j.state),
            );
            ensure(j, '无法终止工序');
            touch();
            const fraction = Math.max(0, 1 - j!.work / RECIPES[j!.recipe].minutes);
            const returned = j!.inputs
              .map((b) => ({ ...b, kg: b.kg * fraction }))
              .filter((b) => b.kg > 1e-8);
            put(tile.ground, returned);
            e.ledger.wasteKg += mass(j!.inputs) - mass(returned);
            j!.inputs = [];
            j!.state = 'cancelled';
            text = '终止工序，未加工部分退回地面';
            break;
          }
          case 'construct': {
            const kind = action.recipe!,
              b = BUILDINGS[kind];
            ensure(b && body.knowledge.includes('build:' + kind), '尚未掌握建造方法');
            let s = tile.structures.find((s) => s.id === action.id);
            if (!s) {
              ensure(tile.biome !== 'water' || kind === 'bridge', '水面仅可建码头桥梁');
              const area =
                tile.fields.reduce((n, f) => n + f.area, 0) +
                tile.structures.reduce((n, s) => n + BUILDINGS[s.kind].area, 0);
              ensure(area + b.area <= tile.area, '土地面积不足');
              requireInputs(stores, b.inputs);
              touch();
              consume(stores, b.inputs);
              s = { id: `building-${e.nextId++}`, kind, progress: 0, condition: 1, contents: [] };
              tile.structures.push(s);
            }
            ensure(s.kind === kind && s.progress < b.minutes, '工程已完成或类型不同');
            touch();
            s.progress = Math.min(
              b.minutes,
              s.progress + 120 * (1 + Math.min(0.33, body.skills.building ?? 0)),
            );
            body.skills.building = (body.skills.building ?? 0) + 0.002;
            text = `建设 ${b.name} ${s.progress.toFixed(0)}/${b.minutes} 分钟`;
            break;
          }
          case 'repair': {
            const s = tile.structures.find((s) => s.id === action.id);
            if (s) {
              const b = BUILDINGS[s.kind],
                fraction = Math.min(0.05, 1 - s.condition);
              ensure(fraction > 0, '设施完好');
              const inputs = Object.fromEntries(
                Object.entries(b.inputs).map(([k, n]) => [k, n * fraction]),
              );
              requireInputs(stores, inputs);
              touch();
              consume(stores, inputs);
              s.condition += fraction;
              text = '修缮建筑';
            } else {
              const tool = body.stock.find((b) => b.id === action.id && (b.wear ?? 0) > 0);
              ensure(tool, '工具不存在或完好');
              const input = tool!.item.startsWith('iron')
                ? 'iron'
                : tool!.item.startsWith('bronze')
                  ? 'bronze'
                  : 'wood';
              requireInputs(stores, { [input]: 0.1 });
              touch();
              consume(stores, { [input]: 0.1 });
              tool!.wear = Math.max(0, tool!.wear! - (ITEMS[tool!.item].durability ?? 1000) * 0.2);
              text = '消耗材料修补工具';
            }
            break;
          }
          case 'clear': {
            ensure(body.knowledge.includes('farming'), '尚不懂耕作');
            ensure(!['water', 'hill'].includes(tile.biome), '这里不适合耕作');
            ensure(capability(stores, 'digging') > 0, '需要挖掘工具');
            let f = tile.fields.find((f) => f.id === action.id);
            if (!f) {
              ensure(
                tile.fields.reduce((n, f) => n + f.area, 0) +
                  tile.structures.reduce((n, s) => n + BUILDINGS[s.kind].area, 0) +
                  0.25 <=
                  tile.area,
                '地块面积不足',
              );
              touch();
              f = {
                id: `field-${e.nextId++}`,
                area: 0.25,
                gdd: 0,
                work: 0,
                harvestWork: 0,
                biomass: 0,
                waterStress: 0,
                fertility: 1,
                harvestKg: 0,
                stage: 'clearing',
              };
              tile.fields.push(f);
            }
            ensure(f.stage === 'clearing' || f.stage === 'fallow', '此田已备好');
            touch();
            f.work += 120 * (1 + capability(stores, 'digging') * 0.2);
            if (f.work >= 100 * f.area * 120) {
              f.stage = 'prepared';
              f.work = 0;
            }
            wear(stores, 'digging', 120);
            text = `备地 ${f.id} ${f.stage}`;
            break;
          }
          case 'sow': {
            const f = tile.fields.find((f) => f.id === action.id),
              c = CROPS[action.crop!];
            ensure(f && f.stage === 'prepared' && c, '需要已备地与有效作物');
            ensure(e.climate.day >= c.plant[0] && e.climate.day <= c.plant[1], '不在播种季节');
            const seed =
              action.crop === 'winter_grain'
                ? 'grain'
                : action.crop === 'flax'
                  ? 'flax_seed'
                  : action.crop === 'hay'
                    ? 'grass_seed'
                    : action.crop!;
            if (!f!.seededKg) requireInputs(stores, { [seed]: c.seed * f!.area });
            ensure(!f!.crop || !f!.seededKg || f!.crop === action.crop, '播种过程中不能更换作物');
            touch();
            if (!f!.seededKg) {
              consume(stores, { [seed]: c.seed * f!.area });
              f!.seededKg = c.seed * f!.area;
              f!.crop = action.crop;
            }
            f!.sowingWork = (f!.sowingWork ?? 0) + 120;
            if (f!.sowingWork < 15 * f!.area * 120) {
              text = `播种劳动 ${f!.sowingWork}/${15 * f!.area * 120} 分钟`;
              break;
            }
            f!.crop = action.crop;
            f!.planted = w.tick;
            f!.gdd = 0;
            f!.waterStress = 0;
            f!.work = 0;
            f!.stage = 'growing';
            text = `播种 ${c.name} ${f!.area} ha`;
            break;
          }
          case 'tend': {
            const f = tile.fields.find((f) => f.id === action.id && f.stage === 'growing');
            ensure(f, '没有生长中的田');
            touch();
            f!.work += 120;
            const n = Math.min(quantity(body.stock, 'water'), 10);
            if (n) {
              take(body.stock, 'water', n);
              tile.soilWater = Math.min(
                tile.waterCapacity,
                tile.soilWater + n / (tile.area * 10000),
              );
            }
            const manure = Math.min(quantity(body.stock, 'manure'), 5);
            if (manure) {
              take(body.stock, 'manure', manure);
              tile.nitrogen += manure * 0.01;
            }
            text = '除草、照料田地并投入实际水肥';
            break;
          }
          case 'harvest': {
            const f = tile.fields.find((f) => f.id === action.id && f.stage === 'ripe');
            ensure(f, '没有成熟作物');
            const c = CROPS[f!.crop!];
            const speed =
              120 *
              (1 + Math.min(0.333, body.skills.farming ?? 0)) *
              (1 + capability(stores, 'reaping') * 0.15);
            const n = Math.min(
              f!.harvestKg,
              (c.yield * f!.area * 0.92 * speed) / (c.harvest * f!.area * 120),
            );
            ensure(n > 0, '作物已收完');
            touch();
            const id =
              f!.crop === 'winter_grain' ? 'grain' : f!.crop === 'flax' ? 'fiber' : f!.crop!;
            const seedFraction = f!.crop === 'flax' ? 0.08 : f!.crop === 'hay' ? 0.01 : 0;
            put(tile.ground, [
              batch(id, n * (1 - seedFraction), w.tick, `harvest-${e.nextId++}`, f!.id),
            ]);
            if (seedFraction)
              put(tile.ground, [
                batch(
                  f!.crop === 'flax' ? 'flax_seed' : 'grass_seed',
                  n * seedFraction,
                  w.tick,
                  `seed-harvest-${e.nextId++}`,
                  f!.id,
                ),
              ]);
            f!.harvestKg -= n;
            f!.harvestWork += 120;
            tile.nitrogen = Math.max(0, tile.nitrogen - (n * Math.max(0, c.nitrogen)) / c.yield);
            if (c.nitrogen < 0) tile.nitrogen += (n * -c.nitrogen) / c.yield;
            e.ledger.harvestedKg += n;
            body.skills.farming = (body.skills.farming ?? 0) + 0.002;
            if (f!.harvestKg < 0.01) {
              f!.stage = 'fallow';
              f!.work = 0;
              f!.seededKg = 0;
              f!.sowingWork = 0;
            }
            wear(stores, 'reaping', 120);
            text = `收割 ${n.toFixed(2)} kg ${ITEMS[id].name} 放在地面`;
            break;
          }
          case 'improve': {
            const kind = action.item ?? 'road';
            ensure(['road', 'irrigation', 'drainage', 'terrace'].includes(kind), '未知土地改造');
            ensure(capability(stores, 'digging') > 0, '改造需要挖掘工具');
            touch();
            if (kind === 'irrigation') {
              const src = w.tiles.find(
                (t) =>
                  t.eco!.region === region && distance(t, a) === 1 && t.eco!.surfaceWater > 1000,
              );
              ensure(src, '周围无可引水源');
              tx.t(src!.x, src!.y, region);
              const n = Math.min(src!.eco!.surfaceWater, 1000);
              src!.eco!.surfaceWater -= n;
              tile.surfaceWater += n;
              tile.soilWater = Math.min(
                tile.waterCapacity,
                tile.soilWater + n / (tile.area * 10000),
              );
            }
            if (kind === 'drainage') {
              tile.surfaceWater = Math.max(0, tile.surfaceWater - 1000);
              tile.soilWater = Math.max(0, tile.soilWater - 1);
            }
            if (kind === 'terrace') tile.slope = Math.max(0.02, tile.slope - 0.001);
            tile.improvements[kind] = Math.min(1, (tile.improvements[kind] ?? 0) + 0.02);
            text = `参与 ${kind} 土方工程`;
            break;
          }
          case 'herd': {
            const h = tile.herds.find((h) => h.id === action.id && h.count > 0);
            ensure(h, '此地没有家畜；野生动物不能即时变家畜');
            touch();
            if (action.item === 'milk') {
              ensure(
                e.climate.day >= 60 &&
                  e.climate.day < 210 &&
                  h!.milkDay !== w.tick &&
                  h!.hunger < 20,
                '不在泌乳条件内',
              );
              const n = h!.females * 0.6;
              ensure(
                mass(body.stock) + n <= capacity(body.stock, w.config.inventoryCapacity),
                '背包负重不足',
              );
              addStock('milk', n, '畜产品');
              h!.milkDay = w.tick;
              h!.hunger += 5;
            } else if (action.item === 'meat') {
              ensure(h!.count > 0, '畜群为空');
              h!.count--;
              h!.females = Math.min(h!.females, h!.count);
              put(tile.ground, [
                batch(
                  'meat',
                  h!.species === 'cattle' ? 150 : 15,
                  w.tick,
                  `slaughter-${e.nextId++}`,
                  h!.id,
                ),
                batch(
                  'hide',
                  h!.species === 'cattle' ? 15 : 3,
                  w.tick,
                  `hide-${e.nextId++}`,
                  h!.id,
                ),
              ]);
            } else h!.health = Math.min(100, h!.health + 2);
            text = '照料 / 获取畜产品';
            break;
          }
          case 'travel': {
            const dest = action.region!;
            ensure(
              dest >= 0 && dest < w.config.regions && Math.abs(dest - region) === 1,
              '只可前往相邻区域',
            );
            ensure(dest > region ? a.x === w.config.size - 1 : a.x === 0, '需先到对应地图边缘');
            ensure(body.waterL >= 1 && body.foodKcal >= 500, '跨区旅程需食物与水储备');
            body.region = dest;
            a.x = dest > region ? 0 : w.config.size - 1;
            body.waterL -= 1;
            body.foodKcal -= 500;
            text = `完成跨区旅程，抵达 ${e.regionNames[dest]}`;
            break;
          }
          case 'study': {
            const id = action.recipe!;
            ensure(
              RECIPES[id] ||
                (id.startsWith('build:') && BUILDINGS[id.slice(6)]) ||
                id === 'farming',
              '未知知识',
            );
            ensure(!body.knowledge.includes(id), '已掌握');
            const teacher = action.targetId ? person(action.targetId) : undefined;
            const heard = a.memories.some((m) => m.source === 'heard' && m.content.includes(id));
            ensure(
              teacher?.eco!.knowledge.includes(id) || heard,
              '需要就近请教知情者或依据听闻试验',
            );
            body.knowledge.push(id);
            w.counters.discoveries++;
            text = `学习并验证 ${id}`;
            break;
          }
        }
        break;
      }
      default:
        throw Error('生态规则请使用 eco 工序动作');
    }
    a.brain!.failures = 0;
    delete a.brain!.lastFailure;
    if (
      a.brain!.forageTrip &&
      action.type === 'eco' &&
      (['collect', 'water', 'drink'].includes(action.op) ||
        (action.op === 'transfer' &&
          action.destination === 'bag' &&
          (ITEMS[action.item!]?.kcal ?? 0) > 0))
    )
      a.brain!.forageTrip.returning = true;
  } catch (err) {
    success = false;
    type = 'action_failed';
    w.counters.failures++;
    a.brain!.failures++;
    a.brain!.lastFailure = err instanceof Error ? err.message : String(err);
    if (w.manor)
      a.brain!.executionBlock = {
        signature: actionConditions(observeEco(w, a), action),
        reason: a.brain!.lastFailure,
      };
    text = `${action.type === 'eco' ? action.op : action.type} 失败：${a.brain!.lastFailure}`;
  }
  text = `${a.name} #${a.id} ${text}`;
  if (
    success &&
    (action.type === 'chat' || action.type === 'shout' || action.type === 'public_speak')
  )
    for (const b of recipients) tx.tell(b, text, 'heard', a.id, 4);
  else {
    tx.tell(a, text, 'observed', undefined, success ? 2 : 5);
    if (success && !['wait', 'eat', 'drink', 'survey', 'discard'].includes(type))
      for (const b of w.agents)
        if (
          !b.death &&
          !b.away &&
          b.id !== a.id &&
          b.eco!.region === a.eco!.region &&
          distance(a, b) <= 1
        )
          tx.tell(b, text, 'observed', undefined, 2);
  }
  if (d.memory_note) {
    const m = {
      id: `note-${w.seq + 1}-${a.id}`,
      day: w.tick,
      content: d.memory_note,
      source: 'inferred' as const,
      eventIds: [w.seq + 1],
      importance: d.memory_note.startsWith('深度反思：') ? 9 : 5,
    };
    a.memories = [...a.memories, m].slice(-200);
    if (w.tick - a.brain!.lastReflection >= 5) {
      a.claims = [...a.claims, { ...m, id: 'claim-' + m.id, importance: 7 }].slice(-40);
      a.brain!.lastReflection = w.tick;
    }
  }
  if (!a.death) readInscriptions(w, tx, a);
  if (w.manor) observeRoyalMission(w, tx, a);
  return tx.finish(type, text, p.id + ':complete', success, a);
}
export function stepEco(w: World) {
  const p = [...w.ecology!.pending].sort((a, b) => a.at - b.at || a.actor - b.actor)[0];
  if (p) return complete(w, p);
  if (w.config.wildlifeEnabled !== false && w.ecology!.wildlifeDay !== w.tick) {
    const tx = new Tx(w);
    const messages = advanceWildlife(w, tx);
    return tx.finish(
      'wildlife',
      messages.join('；') || '野兽在荒野活动',
      `${w.id}:${w.tick}:wildlife`,
      true,
    );
  }
  const tx = new Tx(w),
    day = w.tick;
  if (w.manor) settleManor(w, tx);
  else settleEcology(w, tx);
  w.metrics.push(metricsEco(w));
  if (day >= w.config.days) w.cursor = { phase: 'complete', round: 0, index: 0, ids: [] };
  else {
    w.tick++;
    w.cursor = {
      phase: 'actions',
      round: 0,
      index: 0,
      ids: w.agents.filter((a) => !a.death).map((a) => a.id),
    };
  }
  const event = tx.finish(
    'day_end',
    `第 ${day} 天结束 · ${w.agents.filter((a) => !a.death).length} 人 · ${w.ecology!.climate.season}`,
    `${w.id}:${day}:end`,
    true,
    undefined,
    undefined,
    true,
  );
  event.day = day;
  return event;
}
export function metricsEco(w: World): Metrics {
  const alive = w.agents.filter((a) => !a.death && !a.away);
  const stores = [
    ...alive.map((a) => a.eco!.stock),
    ...w.tiles.flatMap((t) => [t.eco!.ground, ...t.eco!.structures.map((s) => s.contents)]),
  ];
  return {
    day: w.tick,
    alive: alive.length,
    ...w.counters,
    food: stores.reduce((n, s) => n + energy(s) / 2500, 0),
    wildFood: w.tiles.reduce(
      (n, t) =>
        n +
        Object.entries(t.eco!.biomass).reduce(
          (n, [k, q]) => n + (q * (ITEMS[k]?.kcal ?? 0)) / 2500,
          0,
        ),
      0,
    ),
    farms: w.tiles.reduce((n, t) => n + (t.manor?.plot ? 1 : t.eco!.fields.length), 0),
    avgHunger: alive.reduce((n, a) => n + a.hunger, 0) / (alive.length || 1),
    avgLoneliness: alive.reduce((n, a) => n + (a.social?.loneliness ?? 0), 0) / (alive.length || 1),
    depressed: alive.filter((a) => a.social?.depressed).length,
    calls: w.usage.calls,
    inputTokens: w.usage.inputTokens,
    outputTokens: w.usage.outputTokens,
  };
}
export function observeEco(w: World, a: Agent, radius = 1): EcoObservation {
  const body = structuredClone(a.eco!);
  delete body.survey;
  const region = body.region;
  const tiles = w.tiles
    .filter((t) => t.eco!.region === region && distance(a, t) <= radius)
    .map((t) => {
      const eco = structuredClone(t.eco!);
      eco.ground = eco.ground.map(concealLedgerPages);
      for (const s of eco.structures) s.contents = s.contents.map(concealLedgerPages);
      if (w.manor && !canEnter(w, a, t.x, t.y)) for (const s of eco.structures) s.contents = [];
      return { x: t.x, y: t.y, eco };
    });
  const people = w.agents
    .filter(
      (b) =>
        !b.death &&
        !b.away &&
        b.id !== a.id &&
        b.eco!.region === region &&
        distance(a, b) <= radius,
    )
    .map((b) => ({
      id: b.id,
      name: b.name,
      sex: b.sex,
      adult: b.age >= w.config.adultAge,
      x: b.x,
      y: b.y,
      health: b.hp < 35 ? '危急' : b.hp < 70 ? '受伤' : '正常',
      busyUntil: b.eco!.readyAt,
      role: b.role,
    }));
  const corpses = w.agents
    .filter((b) => b.death && b.eco!.region === region && distance(a, b) <= radius)
    .map((b) => ({ id: b.id, name: b.name, x: b.x, y: b.y }));
  corpses.push(
    ...(w.ecology!.relicCorpses ?? [])
      .filter((b) => b.region === region && distance(a, b) <= radius)
      .map(({ id, name, x, y }) => ({ id, name, x, y })),
  );
  const budget =
    w.usage.calls < w.config.maxCalls &&
    w.usage.inputTokens + w.usage.outputTokens < w.config.maxTokens &&
    (!w.config.maxCost || w.usage.cost < w.config.maxCost);
  return {
    manor: manorView(w, a),
    protocol: 'hybrid-1',
    seq: w.seq,
    day: w.tick,
    climate: structuredClone(w.ecology!.climate),
    minute: w.ecology!.clock,
    self: {
      id: a.id,
      name: a.name,
      role: a.role,
      sex: a.sex,
      adult: a.age >= w.config.adultAge,
      hp: a.hp,
      hunger: a.hunger,
      ap: a.ap,
      position: [a.x, a.y],
      body,
      brain: structuredClone(a.brain!),
      personality:
        a.role === 'prophet' ? a.personality.map((v, i) => (i === 2 ? 0.85 : v)) : a.personality,
      combat: combatView(a),
      loneliness: a.social?.loneliness ?? 0,
      lonelinessCapacity: lonelinessCapacity(a),
      depressed: a.social?.depressed ?? false,
      pregnancy: a.pregnancy,
      cooldownUntil: a.cooldownUntil,
    },
    tiles,
    people,
    corpses,
    inscriptions: structuredClone(visibleInscriptions(w, a)),
    beasts: structuredClone(
      (w.ecology!.beasts ?? []).filter(
        (b) => b.hp > 0 && b.region === region && distance(a, b) <= radius,
      ),
    ),
    settlements: settlements({
      ...w,
      agents: w.agents.filter(
        (b) => !b.death && b.eco!.region === region && distance(a, b) <= radius,
      ),
      tiles: w.tiles.filter((t) => t.eco!.region === region && distance(a, t) <= radius),
    }),
    messages: structuredClone(a.inbox.filter((m) => m.source === 'heard' && m.speakerId !== a.id)),
    memories: structuredClone([...a.memories].filter((m) => m.importance >= 4).slice(-10)),
    proposals: structuredClone(
      w.proposals.filter(
        (p) => !p.revoked && !p.completed && w.tick < p.day + 3 && [p.from, p.to].includes(a.id),
      ),
    ),
    jobs: structuredClone(
      w
        .ecology!.jobs.filter(
          (j) =>
            j.region === region &&
            tiles.some((t) => t.x === j.x && t.y === j.y) &&
            j.state !== 'cancelled',
        )
        .slice(-20),
    ),
    ...(radius === 1 && a.eco!.survey
      ? {
          lastSurvey: {
            day: a.eco!.survey.day,
            tiles: a.eco!.survey.tiles,
            people: a.eco!.survey.people,
            corpses: a.eco!.survey.corpses,
          },
        }
      : {}),
    policy: {
      mapSize: w.config.size,
      gestationDays: w.config.gestation,
      adultAgeDays: w.config.adultAge,
      rulesVersion: w.rulesVersion,
      remainingCalls: w.config.maxCalls - w.usage.calls,
      remainingTokens: w.config.maxTokens - w.usage.inputTokens - w.usage.outputTokens,
      contextWindow: w.config.contextWindow,
      wildlifeEnabled: w.config.wildlifeEnabled !== false,
      beastPowerMultiplier: w.config.beastPowerMultiplier ?? 1,
      beastRespawnDays: w.config.beastRespawnDays ?? 10,
      controller: w.config.controller,
      llmDailyCalls: w.config.llmDailyCalls,
      llmDailyTokens: w.config.llmDailyTokens,
      bagKg: w.config.inventoryCapacity,
      dailyAP: w.config.dailyAP,
      budgetAvailable: budget,
    },
  };
}
