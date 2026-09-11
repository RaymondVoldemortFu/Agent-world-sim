import type { Action } from '../sim/types';
import type { Brain, EcoObservation } from '../ecology/types';
import { capacity, mass, quantity } from '../ecology/batches';
import { RATION_KG } from './world';

// No clocks/messages: an unchanged physical precondition must not cause another retry.
export function actionConditions(o: EcoObservation, action: Action): string {
  return JSON.stringify({
    action,
    position: o.self.position,
    stock: o.self.body.stock.map((b) => [b.id, b.item, b.kg, b.quality, b.wear, b.pages?.length]),
    nearby: o.manor?.nearby.map((t) => ({
      x: t.x,
      y: t.y,
      lock: t.site.lock,
      plot: t.site.plot,
      stores: t.stores.map((s) => ({
        id: s.id,
        contents: s.contents?.map((b) => [b.item, b.kg, b.quality]),
      })),
    })),
    space: o.manor?.transferSpace,
    people: o.people.map((p) => ({ id: p.id, x: p.x, y: p.y })),
  });
}
export function prepareManorAction(o: EcoObservation, b: Brain, original: Action): Action {
  if (original.type === 'wait') return original;
  const blocked = (reason: string): Action => {
    b.goalBlocked = reason;
    return { type: 'wait' };
  };
  if (b.executionBlock?.signature === actionConditions(o, original))
    return blocked(b.executionBlock.reason);
  if (original.type !== 'manor') return original;
  const a = { ...original },
    bag = o.self.body.stock;
  const [x, y] = o.self.position;
  const here = o.manor!.nearby.find((t) => t.x === x && t.y === y);
  if (a.op === 'work') {
    const plot = here?.site.plot;
    if (!plot || (a.id && a.id !== plot.id)) return blocked('不在目标田条，重新规划位置');
    if (plot.harvest > 0 && capacity(bag, o.policy.bagKg) - mass(bag) <= 0.001)
      return blocked('背包已满，等待腾出收割空间');
    if (plot.harvest <= 0.001 && plot.work >= plot.required)
      return blocked('本月农活已完成，等待成熟或改变任务');
  }
  if (['withdraw', 'deposit', 'give', 'tribute'].includes(a.op)) {
    const requested = a.amount ?? RATION_KG;
    if (!(requested > 0.001)) return blocked('任务数量必须大于零，请修改或取消目标');
    const item = a.item ?? 'grain';
    let available = quantity(bag, item),
      room = Infinity;
    if (a.op === 'withdraw' || a.op === 'deposit') {
      const store =
        a.id === 'ground'
          ? o.tiles.find((t) => t.x === x && t.y === y)?.eco.ground
          : here?.stores.find((s) => s.id === a.id)?.contents;
      if (!store) return blocked('目标储藏不在当前格或上锁，等待位置或门锁变化');
      if (a.op === 'withdraw') {
        available = quantity(store, item);
        room = capacity(bag, o.policy.bagKg) - mass(bag);
      }
    }
    if (a.op === 'give') {
      const receiver = o.manor!.transferSpace?.find((p) => p.id === a.targetId);
      if (!receiver) return blocked('交付对象当前不可及，等待其靠近或修改目标');
      room = receiver.freeKg;
    }
    a.amount = Math.min(requested, available, room);
    if (item === 'personal_ledger') a.amount = Math.floor(a.amount + 1e-7);
    if (a.amount <= 0.001)
      return blocked(
        available <= 0.001 ? '实际物品不足，等待补货或修改目标' : '负重空间不足，等待腾出空间',
      );
  }
  if (b.executionBlock?.signature === actionConditions(o, a))
    return blocked(b.executionBlock.reason);
  delete b.goalBlocked;
  return a;
}
