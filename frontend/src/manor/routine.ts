import type { Brain, EcoObservation } from '../ecology/types';

// Custom routines are complete replacements; omitted activities stay disabled.
export function manorRoutine(o: EcoObservation, b: Brain = o.self.brain) {
  const r = b.dailyRoutine ?? { mode: 'custom' as const, eat: true };
  const defaults = r.mode === 'default';
  const custom = r.mode === 'custom';
  return {
    mode: r.mode,
    eat: defaults || (custom && r.eat === true),
    fetchFood: defaults || (custom && r.fetchFood === true),
    storeSurplus: defaults || (custom && r.storeSurplus === true),
    farm: defaults || (custom && r.farm === true),
    storeId: custom && r.storeId ? r.storeId : o.manor!.residence.store,
    plots: custom ? (r.plots ?? []) : defaults ? o.manor!.residence.plots : [],
    reserveDays: custom ? (r.reserveDays ?? 2) : (o.manor!.residence.reserveDays ?? 2),
    idleAt: defaults
      ? ([9 + (o.self.id % 2), 10 + (Math.floor(o.self.id / 2) % 2)] as [number, number])
      : custom
        ? (r.idleAt ?? null)
        : null,
    order:
      '随身进食 → 显式目标 → 原地停留 → 领取口粮 → 存余粮 → 田间劳动 → 空闲地点；关闭的步骤跳过。关闭日程不取消既有目标，clearGoal=true取消目标。',
    thresholds:
      '饱食度不足100时按缺口吃随身粮补到100；粮不足则吃完；背包粮少于2日时最多领取3日粮；超出reserveDays+2日才存余粮；农活按月内日期推进配额。',
  };
}
