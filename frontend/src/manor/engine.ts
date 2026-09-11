import type { Agent, World, Action } from '../sim/types';
import type { Tx } from '../sim/transaction';
import type { ManorAction, ManorView } from './types';
import { batch, quantity, take, put, mass, capacity } from '../ecology/batches';
import { ITEMS } from '../ecology/catalog';
import { dieEco } from '../ecology/environment';
import { climate, initBody } from '../ecology/world';
import { makeAgent } from '../sim/world';
import { RATION_KG } from './world';
import { CRAFTS } from './catalog';
import { writeLedger, showLedger, concealLedgerPages } from '../ecology/inscriptions';
export { CRAFTS } from './catalog';
const ensure = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
const near = (a: { x: number; y: number }, b: { x: number; y: number }, r = 1) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= r;
export const hasKey = (a: Agent, key: string) => quantity(a.eco!.stock, key) >= 0.05 - 1e-8;
export const canEnter = (w: World, a: Agent, x: number, y: number) => {
  const t = w.tiles[y * w.config.size + x];
  if (!t) return false;
  if (t.manor?.kind === 'wall') return false;
  const l = t.manor?.lock;
  return !l || !l.locked || l.hp <= 0 || hasKey(a, l.key);
};
export function validateManorAction(w: World, a: Agent, action: Action) {
  if (!w.manor) return;
  if (action.type === 'move')
    ensure(
      canEnter(w, a, a.x + action.dx, a.y + action.dy),
      '石墙或上锁入口阻挡；需要钥匙、开锁或破门',
    );
  if (action.type === 'eco')
    ensure(
      ['eat', 'drink', 'water', 'discard', 'inscribe'].includes(action.op),
      '领地使用 estate 任务：取放、交付、耕作、工坊制作；野地不产食物',
    );
  ensure(!['reproduce'].includes(action.type), '本实验时间尺度内不开放繁衍任务');
}
export function executeManor(w: World, tx: Tx, a: Agent, op: ManorAction): string {
  const state = w.manor!;
  ensure(state, '当前世界不是领地');
  const t = w.tiles[a.y * w.config.size + a.x],
    site = t.manor!;
  const bag = a.eco!.stock,
    item = op.item ?? 'grain',
    n = op.amount ?? RATION_KG;
  const goal = a.brain!.goal;
  const completed = () => {
    a.brain!.lastTaskResult = {
      day: w.tick,
      position: [a.x, a.y],
      op: op.op,
      id: op.id,
      targetId: op.targetId,
      recipe: op.recipe,
      ...(['give', 'tribute', 'deposit', 'withdraw'].includes(op.op) ? { item, amount: n } : {}),
    };
    if (
      (goal?.skill === 'estate' &&
        goal.op === op.op &&
        !['work', 'rest', 'guard'].includes(op.op)) ||
      (goal?.skill === 'deliver' && op.op === 'give')
    ) {
      if (
        (goal.quantity ?? 0) > n + 1e-7 &&
        ['give', 'tribute', 'deposit', 'withdraw'].includes(op.op)
      )
        goal.quantity! -= n;
      else delete a.brain!.goal;
    }
  };
  const log = (to: string, kg: number) =>
    state.accounts.push({ day: w.tick, from: a.id, to, item, kg });
  if (op.op === 'write_ledger' || op.op === 'show_ledger') {
    const result =
      op.op === 'write_ledger'
        ? writeLedger(w, tx, a, op.id, op.text ?? '')
        : showLedger(w, tx, a, op.id, op.targetId);
    completed();
    return result;
  }
  if (op.op === 'report_rebellion') {
    const mission = state.missions.find(
      (m) => m.agentId === a.id && m.kind === 'messenger' && !m.finished,
    );
    ensure(mission?.witnessed, '使者须先亲见领主尸体，才能提交死亡引发的叛乱判断');
    ensure(op.text?.trim(), '叛乱报告须说明判断依据');
    mission!.assessment = op.text!.trim();
    mission!.returning = true;
    completed();
    return '记录本人的叛乱判断，返回道路出口后向王室报告';
  }
  if (op.op === 'rest' || op.op === 'guard')
    return op.op === 'guard' ? '在此守望' : '暂停劳动，休息';
  if (['lock', 'unlock', 'break_lock'].includes(op.op)) {
    const target = w.tiles.find((t) => t.manor?.label === op.id || `${t.x},${t.y}` === op.id);
    ensure(target && near(a, target), '门锁必须在一格内；id填写坐标 x,y');
    const l = target!.manor!.lock;
    ensure(l && l.hp > 0, '没有完好的锁');
    tx.t(target!.x, target!.y);
    if (op.op === 'break_lock') {
      l!.hp = Math.max(0, l!.hp - 30);
      if (l!.hp === 0) {
        l!.locked = false;
        completed();
      }
      return `破坏 (${target!.x},${target!.y}) 门锁，剩余强度 ${l!.hp}`;
    }
    ensure(hasKey(a, l!.key), '你没有持有匹配钥匙');
    l!.locked = op.op === 'lock';
    completed();
    return l!.locked ? '锁上入口' : '打开入口';
  }
  if (op.op === 'work') {
    const p = site.plot;
    ensure(p && (!op.id || p.id === op.id), '需要站在指定农田');
    tx.t(a.x, a.y);
    if (p!.harvest > 0) {
      const kg = Math.min(p!.harvest, capacity(bag, w.config.inventoryCapacity) - mass(bag), 12);
      ensure(kg > 0.001, '背包已满，先存粮');
      p!.harvest -= kg;
      put(bag, [batch('grain', kg, w.tick, `harvest-${w.ecology!.nextId++}`, '田间收割')]);
      w.ecology!.ledger.harvestedKg += kg;
      return `从 ${p!.id} 收割 ${kg.toFixed(2)}kg 谷物`;
    }
    ensure(p!.work < p!.required, '本周期田间劳动已完成，等待月底收成');
    p!.work = Math.min(p!.required, p!.work + 120);
    return `耕作 ${p!.id}，本月完成 ${p!.work}/${p!.required} 分钟`;
  }
  if (op.op === 'withdraw' || op.op === 'deposit') {
    const store =
      op.id === 'ground'
        ? { id: 'ground', contents: t.eco!.ground }
        : t.eco!.structures.find((s) => s.id === op.id && s.condition > 0.2);
    ensure(store, '需要到指定储藏所在格，id填写容器ID');
    const l = op.id === 'ground' ? undefined : site.lock;
    ensure(!l || !l.locked || l.hp <= 0 || hasKey(a, l.key), '储藏上锁，需要手持钥匙或破门');
    const src = op.op === 'withdraw' ? store!.contents : bag,
      dst = op.op === 'withdraw' ? bag : store!.contents;
    ensure(quantity(src, item) + 1e-7 >= n, '实际物品不足，未发生交付');
    if (op.op === 'withdraw')
      ensure(mass(bag) + n <= capacity(bag, w.config.inventoryCapacity) + 1e-6, '超过背包负重');
    tx.t(a.x, a.y);
    put(dst, take(src, item, n));
    log(op.op === 'deposit' ? store!.id : `bag:${a.id}`, n);
    completed();
    return `${op.op === 'withdraw' ? '取出' : '存入'} ${n.toFixed(2)}kg ${item}，容器 ${store!.id}`;
  }
  if (op.op === 'give') {
    const b = w.agents.find((b) => b.id === op.targetId && !b.death && !b.away && b.id !== a.id);
    ensure(b && near(a, b), '交付目标须为附近活人');
    ensure(quantity(bag, item) + 1e-7 >= n, '手上没有足额物品');
    ensure(
      mass(b!.eco!.stock) + n <= capacity(b!.eco!.stock, w.config.inventoryCapacity) + 1e-6,
      '对方背包装不下',
    );
    tx.a(b!);
    put(b!.eco!.stock, take(bag, item, n));
    w.counters.gifts++;
    log(`agent:${b!.id}`, n);
    completed();
    tx.tell(b!, `#${a.id} 实际交给你 ${n.toFixed(2)}kg ${item}`, 'observed', a.id, 7);
    return `交付 #${b!.id} ${n.toFixed(2)}kg ${item}`;
  }
  if (op.op === 'tribute') {
    ensure(a.x === state.exit[0] && a.y === state.exit[1], '贡粮须实物运到道路出口');
    ensure(item === 'grain', '王室只接收谷物');
    ensure(quantity(bag, item) + 1e-7 >= n, '手上贡粮不足');
    put(state.treasury, take(bag, item, n));
    state.king.received += n / RATION_KG;
    state.king.totalReceived += n / RATION_KG;
    log('crown', n);
    completed();
    return `向地图外王室缴纳 ${n.toFixed(2)}kg 谷物`;
  }
  if (op.op === 'craft') {
    ensure(site.kind === 'smithy', '必须到铁匠工棚');
    const r = CRAFTS[op.recipe ?? ''];
    ensure(r, '未知领地配方');
    for (const [i, q] of Object.entries(r.inputs))
      ensure(quantity(bag, i) + 1e-7 >= q, `背包缺少 ${i} ${q}kg`);
    const net =
      Object.values(r.outputs).reduce((a, b) => a + b, 0) -
      Object.values(r.inputs).reduce((a, b) => a + b, 0);
    ensure(mass(bag) + net <= capacity(bag, w.config.inventoryCapacity) + 1e-7, '制作后背包超重');
    for (const [i, q] of Object.entries(r.inputs)) take(bag, i, q);
    for (const [i, q] of Object.entries(r.outputs))
      put(bag, [batch(i, q, w.tick, `craft-${w.ecology!.nextId++}`, '工棚制作')]);
    completed();
    return `完成制作 ${op.recipe}`;
  }
  throw Error('未知领地工序');
}
export function manorView(w: World, a: Agent): ManorView | undefined {
  if (!w.manor || !a.residence) return;
  const mission = w.manor.missions.find((m) => m.agentId === a.id);
  return {
    residence: structuredClone(a.residence),
    map: w.tiles.map((t) => ({
      x: t.x,
      y: t.y,
      kind: t.manor!.kind,
      label: t.manor!.label,
      id: t.manor!.plot?.id,
      stores: t.eco!.structures.map((s) => s.id),
      blocked: t.manor!.kind === 'wall',
    })),
    nearby: w.tiles
      .filter((t) => near(a, t))
      .map((t) => ({
        x: t.x,
        y: t.y,
        site: structuredClone(t.manor!),
        stores: t.eco!.structures.map((s) => ({
          id: s.id,
          ...(canEnter(w, a, t.x, t.y) ? { contents: s.contents.map(concealLedgerPages) } : {}),
        })),
      })),
    transferSpace: w.agents
      .filter((b) => b.id !== a.id && !b.death && !b.away && near(a, b))
      .map((b) => ({
        id: b.id,
        freeKg: Math.max(
          0,
          capacity(b.eco!.stock, w.config.inventoryCapacity) - mass(b.eco!.stock),
        ),
      })),
    external: mission
      ? {
          kind: mission.kind,
          returning: mission.returning,
          comrades: w.manor.missions.map((m) => m.agentId),
          witnessed: mission.witnessed,
          assessment: mission.assessment,
          ...(mission.kind === 'army'
            ? {
                targets: w.agents
                  .filter(
                    (b) =>
                      !b.death && !b.away && !w.manor!.missions.some((m) => m.agentId === b.id),
                  )
                  .map((b) => ({ id: b.id, x: b.x, y: b.y })),
              }
            : {}),
        }
      : undefined,
    // Crop damage becomes known through local inspection, not a global broadcast.
    shock: w.manor.shock && w.tiles.some((t) => t.manor?.plot && near(a, t)),
  };
}
function royalNotice(w: World, tx: Tx, text: string) {
  w.manor!.history.push({ day: w.tick, text });
  // Notices arrive at the entrance; only nearby witnesses hear them.
  for (const a of w.agents)
    if (!a.death && !a.away && near(a, { x: 0, y: 10 }, 2)) tx.tell(a, text, 'heard', undefined, 9);
}
function spawn(w: World, tx: Tx, kind: 'messenger' | 'army', n: number) {
  for (let i = 0; i < n; i++) {
    const a = makeAgent(w, 0, 10);
    initBody(w, a);
    delete a.role;
    a.name = kind === 'messenger' ? '王室使者' : `王军士兵${i + 1}`;
    a.residence = {
      home: [0, 10],
      store: '',
      plots: [],
      keys: [],
      biography:
        kind === 'messenger'
          ? `你因领地已经拖欠王税，奉王命前来强制催缴并带回亲见与听闻。王税是强制义务，到期必须缴足，不存在宽限、减免或延期谈判；歉收、饥荒、死亡、内乱及任何领地因素都不能成为拖欠理由。你无权许诺宽限或更改税期。连续欠税时间超过${2 * w.manor!.settings.graceDays}天，国王会派军镇压所有居民。若你亲见领主尸体，请依据亲历和询问自行判断是否构成叛乱；可用estate report_rebellion填text说明判断，再返回(0,10)报告，报告送达后王室派军。死亡本身不会直接触发王室出兵；你无权撤销已发出的军令。区分亲见和传闻，不要编造报告。`
          : '你奉命无差别攻击领地居民，由王室供应军粮。',
    };
    a.eco!.stock = [
      batch(
        'grain',
        Math.min(20 * RATION_KG, w.config.inventoryCapacity - (kind === 'army' ? 9.9 : 0)),
        w.tick,
        `royal-rations-${a.id}`,
        '王室远征补给',
      ),
    ];
    if (kind === 'army')
      for (const [item, kg] of Object.entries({ iron_sword: 1.4, mail: 6, wooden_shield: 2.5 }))
        a.eco!.stock.push(batch(item, kg, w.tick, `royal-${a.id}-${item}`, '王室装备'));
    a.brain!.combatPolicy = { mode: kind === 'army' ? 'fight' : 'flee' };
    a.ap = w.config.dailyAP;
    w.agents.push(a);
    tx.a(a);
    w.manor!.missions.push({ agentId: a.id, kind, returning: false });
  }
}
export function settleManor(w: World, tx: Tx) {
  const m = w.manor!,
    k = m.king;
  if (k.arrears > 1e-7) k.overdueSince ??= k.dueDay - 30;
  if (m.settings.shockDay > 0 && w.tick >= m.settings.shockDay && !m.shock) {
    m.shock = true;
    m.history.push({ day: w.tick, text: `作物受灾，潜在产量倍率 ${m.settings.yieldMultiplier}` });
  }
  if (w.tick % 30 === 0) {
    let total = 0;
    const multiplier = m.shock ? m.settings.yieldMultiplier : 1;
    for (const t of w.tiles)
      if (t.manor?.plot) {
        tx.t(t.x, t.y);
        const p = t.manor.plot;
        const kg = p.yieldKg * multiplier * Math.min(1, p.work / p.required);
        p.harvest += kg;
        total += kg;
        p.work = 0;
        p.month++;
      }
    m.harvests.push({ day: w.tick, kg: total, potential: 1800 * RATION_KG * multiplier });
    w.ecology!.ledger.outputKg += total;
    m.history.push({ day: w.tick, text: `月底成熟 ${total.toFixed(2)}kg 谷物，待实物收割` });
  }
  for (const mission of m.missions) {
    const a = w.agents.find((a) => a.id === mission.agentId)!;
    if (a.death || mission.finished) continue;
    if (mission.kind === 'messenger') {
      const corpse = w.agents.find((b) => b.id === m.warrantSubject && b.death && near(a, b));
      if (corpse && !mission.witnessed) {
        mission.witnessed = corpse.id;
        mission.report = `亲见受封者 #${corpse.id} 的尸体；死因与凶手尚须调查`;
        tx.tell(a, mission.report, 'observed', undefined, 10);
      }
      const hearsay = a.inbox
        .filter((x) => x.source === 'heard')
        .map((x) => x.content)
        .slice(-2)
        .join('；');
      if (near(a, { x: m.manor[0], y: m.manor[1] }, 4) || w.tick % 10 === 9) {
        mission.returning = true;
        if (hearsay && !mission.report) mission.report = '听闻，未经核实：' + hearsay;
      }
      if (mission.returning && a.x === 0 && a.y === 10) {
        if (mission.report) {
          royalNotice(
            w,
            tx,
            '使者回报：' +
              mission.report +
              (mission.assessment ? '；本人叛乱判断：' + mission.assessment : ''),
          );
          if (mission.witnessed && mission.assessment)
            k.rebellion ??= {
              day: w.tick,
              reason: mission.assessment,
              source: `使者 #${a.id} 亲见后判断并回报`,
            };
        }
        tx.a(a);
        a.away = true;
        a.ap = 0;
        mission.finished = true;
      }
    }
  }
  if (w.tick === k.dueDay) {
    const due = m.settings.royalTax + k.arrears;
    k.arrears = Math.max(0, due - k.received);
    k.received = Math.max(0, k.received - due);
    k.dueDay += 30;
    if (k.arrears > 1e-7) {
      if (k.phase !== 'expedition') k.phase = 'warning';
      k.overdueSince ??= w.tick;
      royalNotice(w, tx, `王税已到期，欠缴 ${k.arrears.toFixed(1)} 人日粮；强制缴纳，无宽限或延期`);
    }
  }
  if (k.arrears > 0 && k.received > 0) {
    const paid = Math.min(k.arrears, k.received);
    k.arrears -= paid;
    k.received -= paid;
  }
  // Preserve continuous debt across installments and partial payments.
  // Old snapshots predate overdueSince; the last tax due date is the conservative fallback.
  if (k.arrears > 1e-7) k.overdueSince ??= k.dueDay - 30;
  else {
    if (k.phase === 'warning') k.phase = 'collecting';
    delete k.overdueSince;
  }
  delete k.deadline;
  if (
    k.arrears > 1e-7 &&
    k.phase !== 'expedition' &&
    (w.tick === k.overdueSince || w.tick % 10 === 1) &&
    !m.missions.some(
      (x) =>
        x.kind === 'messenger' && !x.finished && !w.agents.find((a) => a.id === x.agentId)!.death,
    )
  )
    spawn(w, tx, 'messenger', 1);
  for (const a of w.agents) {
    if (a.death || a.away) continue;
    tx.a(a);
    const b = a.eco!;
    // Staple ration includes routine milling/cooking and household water; no searching for wild food.
    const royalSoldier = m.missions.some(
      (mission) => mission.agentId === a.id && mission.kind === 'army',
    );
    b.foodKcal = royalSoldier ? 5000 : Math.max(0, b.foodKcal - 2500);
    a.hunger = Math.min(100, b.foodKcal / 50);
    b.waterL = 4;
    a.hp = Math.min(100, a.hp + (b.foodKcal <= 0 ? -15 : 2));
    if (a.hp <= 0) {
      dieEco(w, tx, a, '饥饿');
      continue;
    }
    a.age++;
    a.ap = w.config.dailyAP;
    b.readyAt = 0;
    a.brain!.callsDay = 0;
    a.brain!.tokensDay = 0;
  }
  if (
    k.phase !== 'expedition' &&
    ((k.arrears > 1e-7 && w.tick - k.overdueSince! > 2 * m.settings.graceDays) || k.rebellion)
  ) {
    k.phase = 'expedition';
    royalNotice(w, tx, '王室认定抗税失序，派出征缴军队');
    if (
      !m.missions.some(
        (x) => x.kind === 'army' && !x.finished && !w.agents.find((a) => a.id === x.agentId)!.death,
      )
    )
      spawn(w, tx, 'army', m.settings.armySize);
  }
  w.ecology!.clock = 0;
  w.ecology!.climate = climate(w.config.startDay + w.tick, w.config.seed);
}

export function observeRoyalMission(w: World, tx: Tx, a: Agent) {
  const m = w.manor?.missions.find(
    (m) => m.agentId === a.id && m.kind === 'messenger' && !m.finished,
  );
  if (!m) return;
  const corpse = w.agents.find((b) => b.id === w.manor!.warrantSubject && b.death && near(a, b));
  if (corpse && !m.witnessed) {
    m.witnessed = corpse.id;
    m.report = `亲见受封者 #${corpse.id} 的尸体；死因与凶手尚须调查`;
    tx.tell(a, m.report, 'observed', undefined, 10);
  }
}
