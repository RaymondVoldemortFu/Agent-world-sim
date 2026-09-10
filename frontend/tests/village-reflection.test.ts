import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { observeEco } from '../src/ecology/engine';
import { inscribe, visibleInscriptions } from '../src/ecology/inscriptions';
import { ecoAt } from '../src/ecology/world';
import { Tx } from '../src/sim/transaction';
import { deepReflectionDue, shouldThink, interpret, compactContext } from '../src/brain/controller';
import { worldInscriptions } from '../src/ui/inscriptions-data';

it('seeds a readable and writable village board and observable relics without changing population', () => {
  const w = createWorld(
    { worldModel: 'ecology', ecoPreset: 'village', population: 20, wildlifeEnabled: false },
    'relics',
  );
  const a = w.agents[0],
    v = w.ecology!.village!;
  a.x = v.x;
  a.y = v.y;
  expect(w.agents).toHaveLength(20);
  expect(w.counters.deaths).toBe(0);
  const o = observeEco(w, a);
  expect(o.corpses).toHaveLength(3);
  expect(o.people.every((p) => p.id > 0)).toBe(true);
  expect(visibleInscriptions(w, a)[0].text).toBe('野兽非常危险！！需要武器！！');
  const tx = new Tx(w);
  inscribe(w, tx, a, 'wood_tablet', '明日集合制作武器');
  const board = ecoAt(w, v.x, v.y).eco!.structures.find((s) => s.kind === 'noticeboard')!;
  expect(board.contents.filter((b) => b.inscription)).toHaveLength(2);
  expect(
    worldInscriptions(w).find((r) => r.record.text === '明日集合制作武器')!.locations[0].label,
  ).toContain('告示板');
  const wild = createWorld({ worldModel: 'ecology', ecoPreset: 'forager' }, 'no-village');
  expect(wild.ecology!.relicCorpses).toBeUndefined();
});

it('runs reflection once per ten-day period, persists planning and respects budget deferrals', () => {
  const w = createWorld(
    { worldModel: 'ecology', population: 1, wildlifeEnabled: false },
    'reflect',
  );
  const a = w.agents[0];
  w.tick = 9;
  expect(deepReflectionDue(observeEco(w, a))).toBe(false);
  w.tick = 10;
  a.eco!.foodKcal = 500;
  let o = observeEco(w, a);
  expect(shouldThink(o)).toBe(true);
  expect(compactContext(o).deepReflection).toBe(true);
  expect(shouldThink({ ...o, policy: { ...o.policy, budgetAvailable: false } })).toBe(false);
  const d = interpret(o, {
    intent: '先修整，再与邻居合作',
    reflection: { summary: '独自行动风险较高', plan: '十天内组织工具生产和安全巡逻' },
    movement: { stayMinutes: 120 },
    combatPolicy: { mode: 'flee' },
  });
  const before = structuredClone(w);
  const events = [act(w, a.id, d, 'deep-reflection'), endDay(w)];
  expect(a.brain!.lastDeepReflectionDay).toBe(10);
  expect(a.brain!.deepReflection!.plan).toContain('安全巡逻');
  expect(a.memories.some((m) => m.content.includes('未来规划'))).toBe(true);
  events.forEach((e) => applyEvent(before, e));
  expect(hashWorld(before)).toBe(hashWorld(w));
  expect(deepReflectionDue(observeEco(w, a))).toBe(false);
  w.tick = 19;
  expect(deepReflectionDue(observeEco(w, a))).toBe(false);
  w.tick = 20;
  expect(deepReflectionDue(observeEco(w, a))).toBe(true);
  w.tick = 21;
  expect(deepReflectionDue(observeEco(w, a))).toBe(true);
});
