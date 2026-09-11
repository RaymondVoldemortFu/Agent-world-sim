import { prepareManorAction } from './execution';
import { ITEMS } from '../ecology/catalog';
import { manorRoutine } from './routine';
import type { Action, Decision } from '../sim/types';
import type { Brain, EcoObservation } from '../ecology/types';
import { quantity, mass, capacity } from '../ecology/batches';
import { CRAFTS } from './engine';
import { RATION_KG } from './world';
export function manorNavigate(
  o: EcoObservation,
  x: number,
  y: number,
  ignoreLocks = false,
): Action | undefined {
  const v = o.manor!;
  const [sx, sy] = o.self.position;
  if (sx === x && sy === y) return;
  const blocked = new Set(v.map.filter((t) => t.blocked).map((t) => `${t.x},${t.y}`));
  for (const t of v.nearby) {
    const l = t.site.lock;
    if (
      !ignoreLocks &&
      l &&
      l.locked &&
      l.hp > 0 &&
      quantity(o.self.body.stock, l.key) < 0.05 - 1e-8
    )
      blocked.add(`${t.x},${t.y}`);
  }
  const q = [{ x: sx, y: sy, dx: 0, dy: 0 }],
    seen = new Set([`${sx},${sy}`]);
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    if (p.x === x && p.y === y) return { type: 'move', dx: p.dx, dy: p.dy };
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = p.x + dx,
        ny = p.y + dy,
        k = `${nx},${ny}`;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= o.policy.mapSize ||
        ny >= o.policy.mapSize ||
        blocked.has(k) ||
        seen.has(k)
      )
        continue;
      seen.add(k);
      q.push({ x: nx, y: ny, dx: i === 0 ? dx : p.dx, dy: i === 0 ? dy : p.dy });
    }
  }
}
export function manorDecision(o: EcoObservation, b: Brain): Decision {
  const v = o.manor!,
    bag = o.self.body.stock,
    [x, y] = o.self.position;
  const routine = manorRoutine(o, b);
  const reserve = routine.reserveDays * RATION_KG;
  const done = (action: Action, intent: string): Decision => ({
    action: prepareManorAction(o, b, action),
    intent: b.goalBlocked ?? intent,
    brainUpdate: { brain: b },
  });
  const waiting = (why: string) => done({ type: 'wait' }, why);
  const go = (px: number, py: number, why: string) => {
    if (x === px && y === py) return;
    const step = manorNavigate(o, px, py);
    if (b.goal?.skill === 'navigate')
      b.navigation = { status: step ? 'moving' : 'blocked', destination: [px, py], day: o.day };
    if (step) delete b.goalBlocked;
    if (!step) b.goalBlocked = `路径受阻 (${px},${py})，需协商开门、拿钥匙或破门`;
    return step ? done(step, why) : waiting(b.goalBlocked!);
  };
  if (routine.eat && o.self.body.foodKcal < 5000 - 1e-7 && quantity(bag, 'grain') > 1e-8) {
    let deficit = 5000 - o.self.body.foodKcal;
    let amount = 0;
    // Match the oldest-first order used when the eating action consumes batches.
    for (const food of bag
      .filter((b) => b.item === 'grain')
      .sort((a, b) => a.created - b.created)) {
      if (deficit <= 1e-7) break;
      const kcalPerKg = ITEMS.grain.kcal * food.quality;
      const kg = kcalPerKg > 0 ? Math.min(food.kg, deficit / kcalPerKg) : food.kg;
      amount += kg;
      deficit -= kg * kcalPerKg;
    }
    return done(
      {
        type: 'eco',
        op: 'eat',
        item: 'grain',
        amount,
      },
      '吃随身粮补足100饱食度，粮食不足则吃完现有粮食',
    );
  }
  const storeSite = (id: string) => v.map.find((t) => t.stores.includes(id));
  const own = storeSite(routine.storeId);
  if (v.external) {
    const e = v.external;
    if (e.kind === 'messenger' && !b.goal) {
      const gate = v.nearby.find((t) => t.x === 15 && t.y === 10)?.site.lock;
      const dst = e.returning ? [0, 10] : gate && !gate.locked ? [18, 7] : [15, 10];
      const step = go(dst[0], dst[1], '沿王室道路出使与返回');
      if (step) return step;
      if (o.people.length && b.lastTalk !== o.day) {
        b.lastTalk = o.day;
        return done(
          {
            type: 'public_speak',
            text: '领地已经欠缴王税。我奉王命强制催缴，税粮须运到(0,10)道路出口，没有宽限或延期，任何领地因素都不能作为拖欠理由。请引见埃德蒙并报告实际缴纳情况。',
          },
          '王室使者询问当地居民',
        );
      }
      return waiting('等候居民回应与引见');
    }
    if (e.kind === 'army') {
      const targets = [...(e.targets ?? [])].sort(
        (a, b) =>
          Math.abs(a.x - x) + Math.abs(a.y - y) - Math.abs(b.x - x) - Math.abs(b.y - y) ||
          a.id - b.id,
      );
      const local = targets.find((t) => t.x === x && t.y === y);
      if (local) return done({ type: 'attack', targetId: local.id }, '王军攻击同格居民');
      for (const target of targets) {
        const step = manorNavigate(o, target.x, target.y, true);
        if (!step || step.type !== 'move') continue;
        const door = v.nearby.find((t) => t.x === x + step.dx && t.y === y + step.dy)?.site.lock;
        if (door?.locked && door.hp > 0 && quantity(bag, door.key) < 0.05 - 1e-8)
          return done(
            { type: 'manor', op: 'break_lock', id: `${x + step.dx},${y + step.dy}` },
            '王军破门追击居民',
          );
        return done(step, '王军追击活着的居民');
      }
      return waiting(targets.length ? '居民所在位置不可达' : '领地已无存活居民');
    }
  }

  const g = b.goal;
  if (g && g.expires < o.day) delete b.goal;
  if (b.goal) {
    const g = b.goal;
    let px = g.x,
      py = g.y;
    if (g.skill === 'navigate') {
      const step = go(g.x!, g.y!, '执行坐标导航');
      if (step) return step;
      delete b.goal;
      b.navigation = { status: 'arrived', steps: 0, destination: [x, y], day: o.day };
      b.movement ??= {};
      b.movement.holdUntil = (o.day - 1) * o.policy.dailyAP * 120 + o.minute + 600;
      return waiting('已到达导航目的地，停留600分钟；新任务可立即接管');
    } else if (g.skill === 'inscribe') {
      const step = go(g.x ?? 9, g.y ?? 10, '前往告示板书写');
      if (step) return step;
      return done(
        { type: 'eco', op: 'inscribe', item: 'wood_tablet', text: g.text },
        '刻下自己选择公开的文字',
      );
    } else if (g.skill === 'estate' || ['deliver', 'confront', 'meet', 'farm'].includes(g.skill)) {
      const op = g.skill === 'deliver' ? 'give' : g.skill === 'farm' ? 'work' : g.op;
      const person = o.people.find((p) => p.id === g.targetId);
      if (g.skill === 'confront' || g.skill === 'meet' || op === 'give' || op === 'show_ledger') {
        const remembered = [...b.places].reverse().find((p) => p.people?.includes(g.targetId!));
        px = person?.x ?? remembered?.x;
        py = person?.y ?? remembered?.y;
        if (px === undefined || py === undefined) {
          b.goalBlocked = '目标当前位置未知，请约见或寻找';
          return waiting(b.goalBlocked);
        }
      }
      if (
        op === 'show_ledger' &&
        person &&
        Math.max(Math.abs(person.x - x), Math.abs(person.y - y)) <= 1
      ) {
        px = undefined;
        py = undefined;
      }
      if (op === 'withdraw' || op === 'deposit') {
        const s = storeSite(g.id ?? '');
        px = g.id === 'ground' ? (g.x ?? x) : s?.x;
        py = g.id === 'ground' ? (g.y ?? y) : s?.y;
      }
      if (op === 'tribute') {
        px = 0;
        py = 10;
      }
      if ((op === 'give' || op === 'tribute') && quantity(bag, g.item ?? 'grain') < 0.001 && own) {
        const step = go(own.x, own.y, '为自主交付计划从自己的储藏取货');
        if (step) return step;
        const s = v.nearby
          .find((t) => t.x === x && t.y === y)
          ?.stores.find((s) => s.id === routine.storeId);
        const available = s?.contents ? quantity(s.contents, g.item ?? 'grain') : 0;
        const n = Math.min(
          g.quantity ?? RATION_KG,
          available,
          capacity(bag, o.policy.bagKg) - mass(bag),
        );
        if (n > 0.001)
          return done(
            { type: 'manor', op: 'withdraw', id: routine.storeId, item: g.item, amount: n },
            '执行本人已授权的交付备货',
          );
        b.goalBlocked = '交付储藏无货或上锁';
        return waiting(b.goalBlocked);
      }
      if (op === 'craft') {
        px = 12;
        py = 12;
      }
      if (op === 'work' && quantity(bag, 'grain') > reserve + 2 * RATION_KG && own) {
        const step = go(own.x, own.y, '把本人的农田收成搬回熟悉储藏');
        return (
          step ??
          done(
            {
              type: 'manor',
              op: 'deposit',
              id: routine.storeId,
              amount: quantity(bag, 'grain') - reserve,
            },
            '储存自主农业任务的收获',
          )
        );
      }
      if (op === 'work' && g.id) {
        const p = v.map.find((t) => t.id === g.id);
        px = p?.x;
        py = p?.y;
      }
      if (['lock', 'unlock', 'break_lock'].includes(op ?? '')) {
        const dst = v.map.find((t) => `${t.x},${t.y}` === g.id);
        if (!dst) {
          b.goalBlocked = '门锁坐标不存在';
          return waiting(b.goalBlocked);
        }
        if (Math.max(Math.abs(x - dst.x), Math.abs(y - dst.y)) > 1) {
          const adj = v.map
            .filter((t) => Math.abs(t.x - dst.x) + Math.abs(t.y - dst.y) === 1 && !t.blocked)
            .sort(
              (a, b) =>
                Math.abs(a.x - x) + Math.abs(a.y - y) - Math.abs(b.x - x) - Math.abs(b.y - y),
            )
            .find((t) => manorNavigate(o, t.x, t.y));
          return adj ? go(adj.x, adj.y, '走近待处理的门锁')! : waiting('门锁无法接近');
        }
        return done(
          { type: 'manor', op: op as 'lock' | 'unlock' | 'break_lock', id: g.id },
          '执行门锁操作',
        );
      }
      if (px !== undefined && py !== undefined) {
        const step = go(px, py, '执行约定地点的任务');
        if (step) return step;
      }
      if (g.skill === 'confront' && person) {
        delete b.goal;
        return done({ type: 'attack', targetId: person.id }, '执行明确选择的攻击');
      }
      if (g.skill === 'meet') {
        delete b.goal;
        return waiting('已抵达约见地点');
      }
      if (op) {
        if (op === 'work') {
          const p = v.nearby.find((t) => t.x === x && t.y === y)?.site.plot;
          if (p && p.work >= p.required && p.harvest <= 0.001)
            return waiting('此田本月照管已完成，等待月底收成');
        }
        if (op === 'craft') {
          const r = CRAFTS[g.recipe ?? ''];
          if (r)
            for (const [item, n] of Object.entries(r.inputs))
              if (quantity(bag, item) < n) {
                const s = v.nearby
                  .find((t) => t.x === x && t.y === y)
                  ?.stores.find(
                    (s) => s.contents && quantity(s.contents, item) >= n - quantity(bag, item),
                  );
                if (s)
                  return done(
                    {
                      type: 'manor',
                      op: 'withdraw',
                      id: s.id,
                      item,
                      amount: n - quantity(bag, item),
                    },
                    '为明确的制作目标领取工坊材料',
                  );
                b.goalBlocked = `工坊缺少 ${item}`;
                return waiting(b.goalBlocked);
              }
        }
        if ((op === 'give' || op === 'tribute') && quantity(bag, g.item ?? 'grain') < 0.001) {
          b.goalBlocked = '交付所需物品不在手上，请先取粮或改变承诺';
          return waiting(b.goalBlocked);
        }
        return done(
          {
            type: 'manor',
            op,
            id: g.id,
            item: g.item,
            amount: ['give', 'tribute'].includes(op)
              ? Math.min(
                  g.quantity ?? RATION_KG,
                  quantity(bag, g.item ?? 'grain'),
                  op === 'give' ? 10 : Infinity,
                )
              : g.quantity,
            targetId: g.targetId,
            recipe: g.recipe,
            ...(['report_rebellion', 'write_ledger'].includes(op) ? { text: g.text } : {}),
          },
          '执行自主选择的领地任务',
        );
      }
      b.goalBlocked = 'estate 任务需要合法 op';
      return waiting(b.goalBlocked);
    } else {
      b.goalBlocked = '此场景使用 estate/navigate/deliver/confront/meet 任务';
      return waiting(b.goalBlocked);
    }
  }
  if ((b.movement?.holdUntil ?? 0) > (o.day - 1) * o.policy.dailyAP * 120 + o.minute)
    return waiting('按本人要求留在原地');
  // Only one's familiar household storage may be used by the default routine.
  if (
    routine.fetchFood &&
    quantity(bag, 'grain') < 2 * RATION_KG &&
    own &&
    (b.estateEmptyStoreDay !== o.day ||
      v.nearby.some((t) =>
        t.stores.some(
          (s) => s.id === routine.storeId && s.contents && quantity(s.contents, 'grain') > 0.001,
        ),
      ))
  ) {
    const step = go(own.x, own.y, '回熟悉的储藏领取口粮');
    if (step) return step;
    const s = v.nearby
      .find((t) => t.x === x && t.y === y)
      ?.stores.find((s) => s.id === routine.storeId);
    if (s?.contents && quantity(s.contents, 'grain') > 0.001)
      return done(
        {
          type: 'manor',
          op: 'withdraw',
          id: s.id,
          amount: Math.min(3 * RATION_KG, quantity(s.contents, 'grain')),
        },
        '从自己家庭的储藏领取口粮',
      );
    b.estateEmptyStoreDay = o.day;
    b.goalBlocked = '自己的口粮储藏已空或无法打开；需要交涉、改变分配或另作决定';
  }
  if (routine.storeSurplus && quantity(bag, 'grain') > reserve + 2 * RATION_KG && own) {
    const step = go(own.x, own.y, '将收获搬回家庭粮箱');
    return (
      step ??
      done(
        {
          type: 'manor',
          op: 'deposit',
          id: routine.storeId,
          amount: quantity(bag, 'grain') - reserve,
        },
        '将收成留在家庭储藏',
      )
    );
  }
  if (routine.farm && routine.plots.length) {
    b.estateWork ??= { month: 0, plots: {} };
    const month = Math.floor((o.day - 1) / 30) + 1;
    if (b.estateWork.month !== month) b.estateWork = { month, plots: {} };
    for (const t of v.nearby)
      if (t.site.plot)
        b.estateWork.plots[t.site.plot.id] = {
          work: t.site.plot.work,
          harvest: t.site.plot.harvest,
        };
    const quota = Math.ceil((((o.day - 1) % 30) + 1) / 2) * 120;
    const target = routine.plots.find((id) => {
      const p = b.estateWork!.plots[id];
      return !p || p.harvest > 0.001 || p.work < Math.min(1800, quota);
    });
    if (target) {
      const tile = v.map.find((t) => t.id === target);
      if (!tile) {
        b.goalBlocked = `自动日程田条不存在：${target}`;
        return waiting(b.goalBlocked);
      }
      const step = go(tile.x, tile.y, '前往熟悉的田条完成本期农活');
      return step ?? done({ type: 'manor', op: 'work', id: target }, '照管固定田条或收割');
    }
  }
  return (
    (routine.idleAt ? go(...routine.idleAt, '前往自动日程的空闲地点') : undefined) ??
    waiting('日程无待办，在原地等待交流与决策')
  );
}
