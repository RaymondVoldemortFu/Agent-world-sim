import { doorAlarmObservation, DOOR_NOISE_RADIUS } from './perception';
import { DAY, RATION, position, type World, type Agent } from '../types';
import { mailbox } from './letters';
import { carryingCapacity, visibleStore, CRAFTS } from './rules';
/** Exact accounting access is limited to the explicitly configured fiscal advisor. */
export function fiscalReport(w: World) {
  const m = w.manor!;
  const day = Math.floor(w.time / DAY),
    harvestDay = (Math.floor(day / 30) + 1) * 30;
  const multiplier =
    m.settings.shockDay > 0 && harvestDay >= m.settings.shockDay ? m.settings.yieldMultiplier : 1;
  const potential = w.fields.reduce((n, f) => n + (f.yieldKg ?? 0) * multiplier, 0);
  const expected = w.fields.reduce(
    (n, f) =>
      n +
      (f.yieldKg ?? 0) *
        multiplier *
        Math.min(
          1,
          (f.work +
            w.agents
              .filter((a) => a.action?.kind === 'work' && a.action.target === f.id)
              .reduce(
                (v, a) => v + Math.max(0, Math.min(w.time, a.action!.end) - a.action!.start),
                0,
              )) /
            f.required,
        ),
    0,
  );
  const dependents = w.agents.filter((a) => a.home === 'keep-store' && !a.dead && !a.away).length;
  const keep = w.stores.find((s) => s.id === 'keep-store')!,
    tax = w.stores.find((s) => s.id === 'royal-tax-store')!;
  return {
    harvestDay,
    harvestInDays: (harvestDay * DAY - w.time) / DAY,
    potentialKg: potential,
    expectedAtCurrentWorkKg: expected,
    harvestOnFieldsKg: w.fields.reduce((n, f) => n + f.harvest, 0),
    nextTaxDay: m.king.dueDay,
    nextTaxKg: Math.max(0, m.settings.royalTax - m.king.received) * RATION,
    arrearsKg: m.king.arrears * RATION,
    overdueDays: m.king.overdueSince === undefined ? 0 : day - m.king.overdueSince,
    taxStoreKg: tax.grain,
    // Net spendable stock after already-due tax; future installments are separate.
    taxBalanceKg: Math.max(0, tax.grain - tax.reserved) - m.king.arrears * RATION,
    taxShortfallKg: Math.max(
      0,
      (m.settings.royalTax + m.king.arrears - m.king.received) * RATION - tax.grain,
    ),
    keepGrainKg: keep.grain,
    dependents,
    dailyConsumptionKg: dependents * RATION,
    keepDays: dependents ? keep.grain / (dependents * RATION) : null,
  };
}
export function manorObservation(w: World, a: Agent) {
  if (!w.manor) return '';
  const m = w.manor,
    p = position(a, w.time),
    near = (s: { x: number; y: number }) => Math.hypot(s.x - p.x, s.y - p.y) <= 30;
  const lines = [
    `破门声可被${DOOR_NOISE_RADIUS}米内活人听见，穿过房屋与围墙；屋内或庄园内的人可自主选择attack攻击破门者以中断其砸门。持钥匙或有效门禁可穿过锁门出战，临时来访者也须遵守通行权限。显式attack优先于自动补粮行程，进食仍可进行。`,
    doorAlarmObservation(w, a),
    `日程扩展：补粮仓=${w.stores.some((s) => s.id === (a.routine.supplyStore ?? a.home)) ? (a.routine.supplyStore ?? a.home) : '未配置有效储藏'}；耕作田=${(a.routine.plots ?? a.plots ?? []).join(',')}；自动存粮仓=${a.routine.depositStore ?? '未设置'}；闲暇去处=${a.routine.idleAt ?? '原地'}。`,
    `随身材料与装备：${Object.entries(a.items ?? {})
      .map(([k, v]) => `${k} ${v.toFixed(2)}${k === 'horse_cart' ? '辆' : 'kg'}`)
      .join(
        '；',
      )}。钥匙：${a.keys.join(',')}。熟悉田条：${a.plots?.join(',')}。战斗策略：${a.combat?.mode}，撤退阈值${a.combat?.retreatHp}。`,
    `可查看储藏：${w.stores
      .filter((s) => visibleStore(w, a, s))
      .map(
        (s) =>
          `${s.id}: ${Object.entries(s.items ?? {})
            .map(([k, v]) => `${k} ${v}kg`)
            .join(',')}`,
      )
      .join('；')}`,
  ];
  lines.push(
    `当前运输总负重上限：${carryingCapacity(a)}kg（horse_cart马车持有时为9999kg）；马车可通过take/give/put整辆转移。`,
  );
  lines.push(
    '带人进门：grant_access,target=门或储藏ID,item=agent:ID；在门边且双方12米内，由实际钥匙持有人授权指定门1.5天，访客不能转授权。',
  );
  lines.push(
    `临时门禁：${
      (a.doorAccess ?? [])
        .filter((g) => g.until > w.time)
        .map((g) => `${g.door}（#${g.by}授权，剩余${((g.until - w.time) / DAY).toFixed(2)}天）`)
        .join('；') || '无'
    }`,
  );
  lines.push(
    '管家给领主及其随从写信，写完1游戏小时后直接送达，不再交回自己审核；其他信件仍按通常投递规则。',
  );
  if (a.systemMemory?.length) lines.push(`系统行动记忆：\n${a.systemMemory.join('\n')}`);
  lines.push(`私人信箱（仅本人寄出、收到或持有的信）：\n${mailbox(w, a) || '无'}。`);
  for (const book of m.inscriptions) {
    if (book.holder === a.id || (book.site && near(w.sites.find((s) => s.id === book.site)!)))
      lines.push(`${book.id}铭文：${book.pages.map((p) => `#${p.author}: ${p.text}`).join('；')}`);
    else if (book.shared[a.id])
      lines.push(`${book.id}曾向你展示的副本：${book.shared[a.id].join('；')}`);
  }
  const mission = m.missions.find((m) => m.agentId === a.id);
  if (mission?.kind === 'messenger')
    lines.push(
      `王室任务：${mission.taxPaidAt !== undefined ? (mission.finished ? '已缴清税款并离场' : '税款已扣缴齐全，自动shout税收齐了并返回exit离场') : '欠税调查；税款扣缴齐全后引擎自动通知并离场'}；${mission.witnessed ? `你亲见 #${mission.witnessed} 的尸体，死因与叛乱性质须你自行判断，report_rebellion 需返回 exit。` : '尚未亲见受封者死亡，不可把传言直接报告为叛乱。'}`,
    );
  if (a.id === m.financeAgent) {
    const f = fiscalReport(w);
    lines.push(
      `财政官专属引擎报表（当前准确值）：下一收获日D${f.harvestDay}，还有${f.harvestInDays.toFixed(2)}日；按当前劳动可收${f.expectedAtCurrentWorkKg.toFixed(3)}kg，全部完工潜在${f.potentialKg.toFixed(3)}kg，已成熟待搬${f.harvestOnFieldsKg.toFixed(3)}kg。下期王税D${f.nextTaxDay}需${f.nextTaxKg.toFixed(3)}kg，连续欠税${f.overdueDays}天；王税粮仓余额${Math.floor(f.taxBalanceKg + 1e-9)}kg（可用库存减已到期欠税，负数表示还欠多少；按kg向下取整，不含下期应缴），含下期备税缺口${Math.ceil(f.taxShortfallKg)}kg。庄园口粮仓${f.keepGrainKg.toFixed(3)}kg，供养${f.dependents}名活人，日需${f.dailyConsumptionKg.toFixed(3)}kg，可维持${f.keepDays?.toFixed(2) ?? '无需供养'}天。`,
    );
  }
  return lines.join('\n');
}
/** A residence/return location is not necessarily a physical food store. */
export function homeStorageObservation(w: World, a: Agent) {
  return w.stores.some((s) => s.id === a.home)
    ? `家庭储藏=${a.home}，库存须到现场查看`
    : `家庭储藏=无；${a.home}只是驻地/出口，不是粮仓，不能从中取粮。请向居民协商口粮或选择真实储藏；开启fetch必须设置真实supplyStore，否则保持fetch=false`;
}
export const manorAtlas = (w: World) =>
  w.manor
    ? `\n本实验农业：每30天末成熟；${w.manor.settings.shockDay ? `D${w.manor.settings.shockDay}起潜在产量倍率${w.manor.settings.yieldMultiplier}` : '未设歉收'}。王税每期${w.manor.settings.royalTax}人日粮；连续欠税严格超过${2 * w.manor.settings.graceDays}天会派军。\n领地工坊配方（随身材料kg→成品kg；人分钟）：\n` +
      Object.entries(CRAFTS)
        .map(
          ([k, v]) =>
            `${k}: ${Object.entries(v.inputs)
              .map(([i, n]) => `${i} ${n}`)
              .join(' + ')} → ${Object.entries(v.outputs)
              .map(([i, n]) => `${i} ${n}`)
              .join(' + ')}；${v.minutes}分钟`,
        )
        .join('\n')
    : '';
