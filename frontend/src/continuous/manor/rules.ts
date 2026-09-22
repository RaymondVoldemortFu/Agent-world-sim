import { allowedDoors, permitted } from './access';
import { letterTask, validateLetter, settleLetter } from './letters';
import { segmentClear, solids } from '../game/space';
import { CRAFTS } from '../../manor/catalog';
import {
  DAY,
  RATION,
  TILE,
  position,
  type World,
  type Agent,
  type Task,
  type Point,
} from '../types';
import { route } from '../game/navigation';
import { assignRoyalTargets, royalTargetTask } from './royal-navigation';
export { CRAFTS };
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function load(a: Agent) {
  return a.grain + Object.values(a.items ?? {}).reduce((n, v) => n + v, 0) + a.keys.length * 0.05;
}
export const hasCart = (a: Agent) => (a.items?.horse_cart ?? 0) >= 1;
export const carryingCapacity = (a: Agent) => (hasCart(a) ? 9999 : a.capacity);
export function visibleStore(w: World, a: Agent, s: World['stores'][number]) {
  const p = position(a, w.time);
  return (
    distance(p, s) <= 30 &&
    accessible(s, a, w.time) &&
    segmentClear(p, s, solids(w, a.keys, allowedDoors(w, a)))
  );
}
export function accessible(s: World['stores'][number], a: Agent, time = Infinity) {
  return !s.lock?.locked || s.lock.hp <= 0 || permitted(a, s.id, s.lock.key, time);
}
export function targetPoint(w: World, a: Agent, t: Task): Point | undefined {
  if (letterTask(t)) return position(a, w.time);
  if (t.target.startsWith('coord:')) {
    const pair = t.target.slice(6).split(',').map(Number);
    if (
      pair.length === 2 &&
      t.target
        .slice(6)
        .split(',')
        .every((v) => v.trim().length > 0) &&
      pair.every(Number.isFinite)
    )
      return { x: pair[0], y: pair[1] };
    return;
  }
  if (t.target.startsWith('agent:')) {
    const b = w.agents.find((b) => b.id === Number(t.target.slice(6)));
    return b && position(b, w.time);
  }
  if (['break_lock', 'unlock', 'lock', 'grant_access'].includes(t.kind)) {
    const s = w.sites.find((s) => s.id === t.target);
    if (s && ['home', 'hall'].includes(s.kind))
      return { x: s.x, y: s.y + (s.kind === 'hall' ? 9 : 6) + 2 };
  }
  const book = w.manor?.inscriptions.find((b) => b.id === t.target);
  if (book?.holder === a.id) return position(a, w.time);
  return w.sites.find((s) => s.id === (book?.site ?? t.target));
}
const amount = (a: Agent, item: string) =>
  item === 'grain'
    ? a.grain
    : item.startsWith('key_')
      ? a.keys.includes(item)
        ? 0.05
        : 0
      : (a.items?.[item] ?? 0);
function add(a: Agent, item: string, n: number) {
  if (item === 'grain') a.grain = Math.max(0, a.grain + n);
  else if (item.startsWith('key_')) {
    if (n > 0 && !a.keys.includes(item)) a.keys.push(item);
    if (n < 0) a.keys = a.keys.filter((k) => k !== item);
  } else {
    a.items ??= {};
    a.items[item] = Math.max(0, (a.items[item] ?? 0) + n);
  }
}
function ledgerTransfer(w: World, from: Agent, to: Agent, item: string) {
  if (item !== 'personal_ledger') return;
  const b = w.manor!.inscriptions.find((b) => b.holder === from.id);
  if (b) b.holder = to.id;
}
export function validateOperation(w: World, a: Agent, t: Task): string | undefined {
  if (!w.manor) return '该场景未启用领地动作';
  if (letterTask(t)) return validateLetter(w, a, t);
  const s = w.stores.find((s) => s.id === t.target),
    b = w.agents.find((b) => `agent:${b.id}` === t.target),
    g = w.gates.find((g) => g.id === t.target);
  if (t.kind === 'grant_access') {
    const recipient = w.agents.find((v) => `agent:${v.id}` === t.item);
    const key = s?.lock?.key ?? g?.key;
    if (!key || !a.keys.includes(key)) return '带人进门需要持有该门的实际钥匙；临时授权不能转授权';
    if (!recipient || recipient.dead || recipient.away || recipient.id === a.id)
      return '带人进门需 item=agent:ID 指定另一名在场活人';
    if (distance(position(a, w.time), position(recipient, w.time)) > 12)
      return '带人进门需被授权人在你12米内';
  }
  if (['take', 'put'].includes(t.kind) && !s && !(t.kind === 'take' && b?.dead))
    return '需要储藏或尸体目标';
  if (['take', 'put'].includes(t.kind) && s && !accessible(s, a, w.time))
    return `door_locked：${t.target} 门锁了无法进入；需钥匙、unlock，或 break_lock target=${t.target} 暴力破门（一次一击，可重复）`;
  if (['give', 'attack', 'show'].includes(t.kind) && (!b || b.dead || b.away || b.id === a.id))
    return '需要另一名现场活人';
  if (t.kind === 'tribute' && t.target !== 'royal-tax-store')
    return '王税粮食必须存入 royal-tax-store';
  if (t.kind === 'craft' && (t.target !== 'workshop' || !CRAFTS[t.item ?? '']))
    return '需在 workshop 指定已知配方 item';
  if (['lock', 'unlock', 'break_lock'].includes(t.kind) && !s?.lock && !g) return '目标没有锁';
  if (
    t.kind === 'break_lock' &&
    (g ? g.open || (g.hp ?? 240) <= 0 : s?.lock && (!s.lock.locked || s.lock.hp <= 0))
  )
    return '门已开放或锁已损坏，无需破门';
  if (['lock', 'unlock'].includes(t.kind) && !a.keys.includes(s?.lock?.key ?? g!.key))
    return '没有对应钥匙';
  if (t.kind === 'write') {
    const book = w.manor.inscriptions.find((b) => b.id === t.target);
    if (!book || (book.holder !== undefined && book.holder !== a.id))
      return '必须持有账簿，或在公共告示板现场';
    if (!t.text) return '需要 text';
  }
  if (t.kind === 'show' && !w.manor.inscriptions.some((b) => b.id === t.item && b.holder === a.id))
    return 'item 需为你持有的账簿ID';
  if (t.kind === 'report_rebellion') {
    const m = w.manor.missions.find((m) => m.agentId === a.id && m.kind === 'messenger');
    if (!m?.witnessed || !t.text || t.target !== 'exit')
      return '使者须亲见受封者尸体、给出本人判断并返回 exit 汇报';
  }
  return undefined;
}
export function operationMinutes(t: Task) {
  if (t.kind === 'grant_access') return 5;
  if (letterTask(t)) return t.kind === 'write_letter' ? 30 : 5;
  return t.kind === 'craft'
    ? (CRAFTS[t.item ?? '']?.minutes ?? 60)
    : t.kind === 'write'
      ? 60
      : t.kind === 'show'
        ? 24
        : ['attack', 'break_lock'].includes(t.kind)
          ? 48
          : 24;
}
/** Revalidates stock, capacity, locks and contact at settlement; interruption has no side effects. */
export function settleOperation(
  w: World,
  a: Agent,
  t: Task,
): { text: string; damaged?: Agent; listeners?: number[]; doorNoise?: 'hit' | 'broken' } {
  const error = validateOperation(w, a, t);
  if (error) return { text: `操作失败：${error}` };
  const p = targetPoint(w, a, t);
  if (!p || distance(position(a, w.time), p) > 4) return { text: '操作失败：目标已离开交互距离' };
  if (letterTask(t)) return { text: settleLetter(w, a, t) };
  const item = t.item ?? 'grain',
    s = w.stores.find((s) => s.id === t.target),
    b = w.agents.find((b) => `agent:${b.id}` === t.target),
    g = w.gates.find((g) => g.id === t.target);
  let n = 0;
  switch (t.kind) {
    case 'grant_access': {
      const recipient = w.agents.find((v) => `agent:${v.id}` === t.item)!;
      recipient.doorAccess = (recipient.doorAccess ?? []).filter((g) => g.door !== t.target);
      recipient.doorAccess.push({ door: t.target, by: a.id, until: w.time + 1.5 * DAY });
      recipient.nextThink = Math.min(recipient.nextThink, w.time);
      return {
        text: `已带 #${recipient.id} 进门：授权访问 ${t.target}，从现在起1.5游戏天有效；未转交钥匙，不能开关锁或转授权`,
        listeners: [recipient.id],
      };
    }

    case 'give':
      n = Math.min(t.amount, amount(a, item), Math.max(0, carryingCapacity(b!) - load(b!)));
      if (item === 'horse_cart') {
        n = Math.floor(n);
        if (amount(a, item) - n < 1 && load(a) - n > a.capacity)
          return { text: '操作失败：请先卸下超重货物，再转交最后一辆马车' };
      }
      if (item === 'personal_ledger') n = n >= 1 ? 1 : 0;
      if (item.startsWith('key_')) n = n >= 0.05 ? 0.05 : 0;
      add(a, item, -n);
      add(b!, item, n);
      if (n) ledgerTransfer(w, a, b!, item);
      break;
    case 'take':
      if (b) {
        n = Math.min(t.amount, amount(b, item), Math.max(0, carryingCapacity(a) - load(a)));
        if (item === 'horse_cart') n = Math.floor(n);
        if (item === 'personal_ledger') n = n >= 1 ? 1 : 0;
        if (item.startsWith('key_')) n = n >= 0.05 ? 0.05 : 0;
        add(b, item, -n);
        add(a, item, n);
        if (n) ledgerTransfer(w, b, a, item);
      } else {
        if (item === 'personal_ledger' || item.startsWith('key_'))
          return { text: '钥匙和账簿使用 give 直接交给人物' };
        n = Math.min(
          t.amount,
          item === 'grain' ? s!.grain - s!.reserved : (s!.items?.[item] ?? 0),
          Math.max(0, carryingCapacity(a) - load(a)),
        );
        if (item === 'horse_cart') n = Math.floor(n);
        if (item === 'grain') s!.grain -= n;
        else {
          s!.items ??= {};
          s!.items[item] = (s!.items[item] ?? 0) - n;
        }
        add(a, item, n);
      }
      break;
    case 'put':
      if (item === 'personal_ledger' || item.startsWith('key_'))
        return { text: '钥匙和账簿使用 give 直接交给人物' };
      n = Math.min(t.amount, amount(a, item));
      if (item === 'horse_cart') {
        n = Math.floor(n);
        if (amount(a, item) - n < 1 && load(a) - n > a.capacity)
          return { text: '操作失败：请先卸下超重货物，再存放最后一辆马车' };
      }
      add(a, item, -n);
      if (item === 'grain') s!.grain += n;
      else {
        s!.items ??= {};
        s!.items[item] = (s!.items[item] ?? 0) + n;
      }
      break;
    case 'tribute': {
      if (
        !accessible(
          w.stores.find((s) => s.id === 'royal-tax-store')!,
          a,
          w.time,
        )
      )
        return { text: 'door_locked：王税粮仓门锁了，需钥匙或 break_lock' };
      n = Math.min(a.grain, t.amount);
      a.grain -= n;
      w.stores.find((s) => s.id === 'royal-tax-store')!.grain += n;
      break;
    }
    case 'craft': {
      const recipe = CRAFTS[item];
      if (Object.entries(recipe.inputs).some(([k, v]) => amount(a, k) < v))
        return { text: '制造失败：随身材料不足，需先从工坊领取' };
      const net =
        Object.values(recipe.outputs).reduce((n, v) => n + v, 0) -
        Object.values(recipe.inputs).reduce((n, v) => n + v, 0);
      if (load(a) + net > carryingCapacity(a)) return { text: '制造失败：成品超过负重' };
      for (const [k, v] of Object.entries(recipe.inputs)) add(a, k, -v);
      for (const [k, v] of Object.entries(recipe.outputs)) add(a, k, v);
      return { text: `制造完成：${item}` };
    }
    case 'unlock':
    case 'lock':
      if (g) g.open = t.kind === 'unlock';
      else s!.lock!.locked = t.kind === 'lock';
      return { text: `${t.kind} ${t.target}` };
    case 'break_lock': {
      const damage = attackPower(a);
      if (g) {
        g.hp = Math.max(0, (g.hp ?? 240) - damage);
        if (!g.hp) g.open = true;
      } else {
        s!.lock!.hp = Math.max(0, s!.lock!.hp - damage);
        if (!s!.lock!.hp) s!.lock!.locked = false;
      }
      return {
        text: `破锁 ${t.target}，耐久 ${g?.hp ?? s!.lock!.hp}`,
        doorNoise: (g?.hp ?? s!.lock!.hp) <= 0 ? 'broken' : 'hit',
      };
    }
    case 'attack': {
      if (
        !segmentClear(
          position(a, w.time),
          position(b!, w.time),
          solids(w, a.keys, allowedDoors(w, a)),
        )
      )
        return { text: '操作失败：墙体或锁门阻挡攻击，需先到可接触的位置' };
      let damage = Math.max(2, attackPower(a) - defense(b!));
      const hall = w.sites.find((s) => s.kind === 'hall');
      if (hall && distance(position(b!, w.time), hall) < 10) damage *= 0.8;
      b!.hp = Math.max(0, b!.hp - damage);
      return { text: `攻击 #${b!.id}，造成 ${damage.toFixed(1)} 伤害`, damaged: b };
    }
    case 'write':
      w.manor!.inscriptions.find((b) => b.id === t.target)!.pages.push({
        time: w.time,
        author: a.id,
        text: t.text!,
      });
      return { text: `在 ${t.target} 写入文字` };
    case 'show': {
      const book = w.manor!.inscriptions.find((b) => b.id === t.item)!;
      book.shared[b!.id] = book.pages.map((p) => p.text);
      return { text: `向 #${b!.id} 展示 ${book.id}` };
    }
    case 'report_rebellion': {
      const m = w.manor!.missions.find((m) => m.agentId === a.id)!;
      m.assessment = t.text;
      m.finished = true;
      a.away = true;
      w.manor!.king.rebellion = `使者 #${a.id} 亲见 #${m.witnessed} 尸体后判断：${t.text}`;
      return { text: '使者已返回地图外，向国王报告叛乱判断' };
    }
  }
  return {
    text:
      n > 0
        ? `${t.kind} ${item} ${n.toFixed(3)}kg → ${t.target}`
        : '操作失败：可用物品或负重空间不足',
  };
}
export function attackPower(a: Agent) {
  return (a.items?.iron_sword ?? 0) >= 1.4
    ? 26
    : (a.items?.iron_spear ?? 0) >= 1.8
      ? 23
      : (a.items?.iron_knife ?? 0) >= 0.5
        ? 12
        : 6;
}
function defense(a: Agent) {
  return (
    ((a.items?.mail ?? 0) >= 6 ? 12 : (a.items?.leather_armor ?? 0) >= 3 ? 6 : 0) +
    ((a.items?.wooden_shield ?? 0) >= 2.5 ? 5 : 0)
  );
}
export function spawnRoyal(w: World, kind: 'messenger' | 'army', count: number) {
  const exit = w.sites.find((s) => s.id === 'exit')!,
    base = w.agents[0];
  for (let i = 0; i < count; i++) {
    const id = Math.max(...w.agents.map((a) => a.id)) + 1;
    const a: Agent = {
      ...structuredClone(base),
      id,
      name: kind === 'messenger' ? `王室使者${id}` : `王军${id}`,
      biography:
        '你是地图外国王派来的王室使者，只向国王负责。你的任务只有调查税款是否缴足及是否发生叛乱。你不是税收官，不负责帮助领主收税、协调运粮、组织平民或替农民争取正义。领主、随从与农民的死活不在你的职责内；国王只看是否交足税，不关心欠税是谁的责任，也不接受关门、饥荒或内部纠纷的辩解。王室税是强制的，无宽限、减免或延期，任何领地因素都不能成为拖欠理由。调查受封者 #1，亲见死亡只是证据，需由你判断是否叛乱；只有亲自返回 exit 并 report_rebellion，国王才会收到判断。可与居民对话并查看尸体。',
      personality: [0.4, 0.9, 0.8, 0.1, 0.3],
      color: 0x713d73,
      x: exit.x,
      y: exit.y,
      home: 'exit',
      plot: '',
      plots: [],
      keys: [],
      items: { iron_sword: 1.4, mail: 6, wooden_shield: 2.5 },
      grain: 10 * RATION,
      hp: 100,
      food: 5000,
      bodyAt: w.time,
      dead: false,
      away: false,
      task: kind === 'messenger' ? { kind: 'navigate', target: 'plaza', amount: 1 } : undefined,
      routine: { eat: true, fetch: false, reserveDays: 7, work: false },
      combat: { mode: 'fight', retreatHp: 1 },
      planVersion: 0,
      intent: kind === 'messenger' ? '调查欠税与当地情况' : '奉命镇压',
      nextThink: w.time,
      lastRead: 0,
      thoughts: 0,
      tokens: 0,
      action: undefined,
      motion: undefined,
      voice: undefined,
      thinking: undefined,
      blocked: undefined,
      stats: { workMs: 0, distance: 0, eatenKg: 0, spoken: 0, deliveredKg: 0 },
    };
    w.agents.push(a);
    w.manor!.missions.push({ agentId: id, kind });
    w.ledger.initial += a.grain;
  }
}
export function royalDay(w: World, day: number): string[] {
  const m = w.manor!,
    k = m.king,
    notes: string[] = [];
  if (day === m.settings.shockDay)
    notes.push(`歉收开始，潜在产量变为 ${m.settings.yieldMultiplier * 100}%`);
  if (day === k.dueDay) {
    const due = m.settings.royalTax + k.arrears;
    k.arrears = Math.max(0, due - k.received);
    k.received = Math.max(0, k.received - due);
    k.dueDay += 30;
    if (k.arrears > 1e-7) {
      k.overdueSince ??= day;
      if (k.phase !== 'expedition') k.phase = 'warning';
      notes.push(`王税到期，需扣缴 ${k.arrears.toFixed(1)} 人日粮，无宽限`);
    }
  }
  const tax = w.stores.find((s) => s.id === 'royal-tax-store')!;
  const paid = Math.min(k.arrears * RATION, Math.max(0, tax.grain - tax.reserved));
  if (paid > 0) {
    tax.grain -= paid;
    k.arrears = Math.max(0, k.arrears - paid / RATION);
    k.totalReceived += paid / RATION;
    m.treasury += paid;
    w.resourceVersion++;
    notes.push(`王税粮仓自动扣缴 ${paid.toFixed(3)}kg，仍欠 ${k.arrears.toFixed(2)} 人日粮`);
  }
  if (k.arrears < 1e-7) {
    delete k.overdueSince;
    if (k.phase === 'warning') k.phase = 'collecting';
  }
  if (
    k.arrears > 1e-7 &&
    k.phase !== 'expedition' &&
    !m.missions.some(
      (m) =>
        m.kind === 'messenger' && !m.finished && !w.agents.find((a) => a.id === m.agentId)!.dead,
    )
  ) {
    spawnRoyal(w, 'messenger', 1);
    notes.push('王室使者从道路进入领地调查欠税');
  }
  if (
    k.phase !== 'expedition' &&
    ((k.arrears > 1e-7 && day - k.overdueSince! > 2 * m.settings.graceDays) || k.rebellion)
  ) {
    k.phase = 'expedition';
    spawnRoyal(w, 'army', m.settings.armySize);
    notes.push('国王派出王军，无差别镇压当地居民');
  }
  return notes;
}
export function witness(w: World, a: Agent) {
  const m = w.manor?.missions.find((m) => m.agentId === a.id && m.kind === 'messenger');
  if (!m || m.witnessed) return false;
  const b = w.agents.find((b) => b.id === w.manor!.warrantSubject);
  if (b?.dead && distance(position(a, w.time), b) <= 30) {
    m.witnessed = b.id;
    return true;
  }
  return false;
}
export function royalTask(w: World, a: Agent): Task | undefined {
  if (!w.manor?.missions.some((m) => m.agentId === a.id && m.kind === 'army')) return;
  const target = assignRoyalTargets(w).get(a.id);
  return target ? royalTargetTask(w, a, target) : undefined;
}
/** Optional deterministic baseline; production LLM residents begin with eating only. */
export function demoPlan(w: World, a: Agent): Task | undefined {
  if (!w.manor || w.mode !== 'scripted' || w.manor.missions.some((m) => m.agentId === a.id)) return;
  if (a.grain < 2 * RATION) return { kind: 'supply', target: a.home, amount: 7 * RATION };
  if (a.plots?.length) {
    if (a.grain > 9 * RATION)
      return { kind: 'deliver', target: a.home, amount: Math.max(0, a.grain - 7 * RATION) };
    const f = w.fields.find(
      (f) => a.plots!.includes(f.id) && (f.harvest > 0 || f.work < f.required),
    );
    if (f) return { kind: 'farm', target: f.id, amount: 1 };
  }
  return { kind: 'rest', target: 'plaza', amount: 1 };
}
