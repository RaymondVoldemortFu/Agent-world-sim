import { expect, it } from 'vitest';
import { createManorWorld } from '../src/continuous/manor/world';
import { spawnRoyal, settleOperation, targetPoint } from '../src/continuous/manor/rules';
import { assignRoyalTargets, royalTargetTask } from '../src/continuous/manor/royal-navigation';
import { ContinuousEngine } from '../src/continuous/engine';
import { DAY, applyEvent } from '../src/continuous/types';

function fixture() {
  const w = createManorWorld('royal-targets', 'llm');
  spawnRoyal(w, 'army', 10);
  return w;
}
it('assigns ten different omniscient targets and preserves locks across movement and hydration', () => {
  const w = fixture(),
    assigned = assignRoyalTargets(w);
  expect(new Set([...assigned.values()].map((a) => a.id)).size).toBe(10);
  const original = [...assigned].map(([id, a]) => [id, a.id]);
  for (const a of w.agents) {
    a.x += 5;
    a.y += 5;
  }
  expect([...assignRoyalTargets(structuredClone(w))].map(([id, a]) => [id, a.id])).toEqual(
    original,
  );
  const victim = assigned.values().next().value!;
  victim.dead = true;
  expect([...assignRoyalTargets(w).values()].some((a) => a.id === victim.id)).toBe(false);
  expect(new Set([...assignRoyalTargets(w).values()].map((a) => a.id)).size).toBe(10);
});
it('balances fewer remaining victims and excludes the messenger and departed residents', () => {
  const w = fixture();
  for (const a of w.agents.slice(3, 32)) a.away = true;
  spawnRoyal(w, 'messenger', 1);
  const assignments = assignRoyalTargets(w),
    counts = new Map<number, number>();
  for (const a of assignments.values()) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
  expect([...counts.keys()].sort()).toEqual([1, 2, 3]);
  expect([...counts.values()].sort()).toEqual([3, 3, 4]);
  w.agents.slice(0, 3).forEach((a) => (a.dead = true));
  expect(assignRoyalTargets(w).size).toBe(0);
});
it('breaches the actual first gate, then the hall door, then resumes its locked victim', () => {
  const w = fixture(),
    soldier = w.agents[32],
    victim = w.agents[0];
  const keep = w.stores.find((s) => s.id === 'keep-store')!;
  const gate = w.gates[0];
  keep.lock!.locked = true;
  gate.open = false;
  Object.assign(victim, { x: keep.x, y: keep.y });
  let task = royalTargetTask(w, soldier, victim)!;
  expect(task).toMatchObject({ kind: 'break_lock', target: gate.id });
  // Break from outside the physical gate, rather than toggling it in the test.
  Object.assign(soldier, { x: gate.x - 3.2, y: gate.y });
  for (let i = 0; i < 20 && !gate.open; i++) settleOperation(w, soldier, task);
  expect(gate.open).toBe(true);
  task = royalTargetTask(w, soldier, victim)!;
  expect(task).toMatchObject({ kind: 'break_lock', target: keep.id });
  Object.assign(soldier, targetPoint(w, soldier, task));
  for (let i = 0; i < 20 && keep.lock!.locked; i++) settleOperation(w, soldier, task);
  expect(keep.lock!.locked).toBe(false);
  expect(royalTargetTask(w, soldier, victim)).toMatchObject({
    kind: 'attack',
    target: `agent:${victim.id}`,
  });
  expect(soldier.keys).toEqual([]);
});
it('does not attack an unrelated locked gate when the victim is already reachable', () => {
  const w = fixture(),
    a = w.agents[32],
    b = w.agents[0];
  Object.assign(b, { x: a.x + 30, y: a.y });
  expect(w.gates[0].open).toBe(false);
  expect(royalTargetTask(w, a, b)).toMatchObject({ kind: 'attack', target: `agent:${b.id}` });
});
it('executes walking, gate damage, house damage and combat without manual teleportation', () => {
  const w = fixture();
  for (const a of w.agents) if (a.id !== 1 && a.id !== 33) a.dead = true;
  const victim = w.agents[0],
    keep = w.stores.find((s) => s.id === 'keep-store')!;
  Object.assign(victim, { x: keep.x, y: keep.y });
  keep.lock!.locked = true;
  victim.combat = { mode: 'fight', retreatHp: 1 };
  const engine = new ContinuousEngine(w);
  engine.pause(false);
  engine.advance(DAY * 2);
  const hits = engine.events
    .filter((e) => e.type === 'estate' && e.actor === 33)
    .map((e) => e.text);
  expect(hits.some((t) => t.includes('破锁 gate'))).toBe(true);
  expect(hits.some((t) => t.includes('破锁 keep-store'))).toBe(true);
  expect(hits.some((t) => t.includes('攻击 #1'))).toBe(true);
});
it('tracks a moving victim and records military assignments in replay', () => {
  const w = fixture();
  // One pursuer with an old navigation endpoint, victim now somewhere else.
  for (const a of w.agents) if (a.id !== 1 && a.id !== 33) a.dead = true;
  const a = w.agents[32],
    b = w.agents[0];
  Object.assign(b, { x: 180, y: 220 });
  const initial = structuredClone(w),
    engine = new ContinuousEngine(w);
  engine.pause(false);
  engine.advance(1000);
  expect(a.task?.target).toBe('agent:1');
  b.x = 70; // A target move is an external change in this fixture.
  b.y = 180;
  engine.advance(31 * 60000);
  expect(a.motion!.points.at(-1)!.x).toBeLessThan(80);
  const replay = structuredClone(initial);
  for (const e of engine.events) applyEvent(replay, e);
  replay.time = w.time;
  expect(replay).toEqual(w);
});
