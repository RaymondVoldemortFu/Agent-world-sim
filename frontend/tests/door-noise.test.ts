import { expect, it } from 'vitest';
import { ContinuousEngine } from '../src/continuous/engine';
import { DAY, applyEvent } from '../src/continuous/types';
import { createManorWorld } from '../src/continuous/manor/world';
import {
  hearDoorNoise,
  DOOR_NOISE_RADIUS,
  doorAlarmObservation,
} from '../src/continuous/manor/perception';
import { settleOperation } from '../src/continuous/manor/rules';
const world = () => createManorWorld('door-noise', 'llm');
it('sound crosses walls up to 150m, excludes dead/away people and never forces combat', () => {
  const w = world(),
    attacker = w.agents[28],
    inside = w.agents[7],
    edge = w.agents[8],
    far = w.agents[9],
    dead = w.agents[10],
    away = w.agents[11];
  const at = { x: 100, y: 100 };
  Object.assign(inside, { x: 100, y: 98, nextThink: DAY });
  Object.assign(edge, { x: 100 + DOOR_NOISE_RADIUS, y: 100, nextThink: DAY });
  Object.assign(far, { x: 250.01, y: 100, nextThink: DAY });
  Object.assign(dead, { x: 100, y: 100, dead: true });
  Object.assign(away, { x: 100, y: 100, away: true });
  const routine = structuredClone(inside.routine);
  const listeners = hearDoorNoise(w, attacker, 'home-1', at, 'start');
  expect(listeners).toContain(inside.id);
  expect(listeners).toContain(edge.id);
  for (const a of [far, dead, away, attacker]) expect(listeners).not.toContain(a.id);
  expect(inside.nextThink).toBe(0);
  expect(far.nextThink).toBe(DAY);
  expect(inside.routine).toEqual(routine);
  expect(inside.task).toBeUndefined();
  expect(doorAlarmObservation(w, inside)).toContain('attack,target=agent:29');
});
it('repeated strikes coalesce wakeups while a breach wakes immediately and late plans are rejected', () => {
  const w = world(),
    a = w.agents[7],
    attacker = w.agents[28];
  Object.assign(a, { x: 100, y: 100 });
  const e = new ContinuousEngine(w);
  const thinking = e.thinking(a.id, 'pending')!;
  hearDoorNoise(w, attacker, 'home-1', { x: 100, y: 100 }, 'start');
  const version = a.planVersion;
  w.time = 1000;
  hearDoorNoise(w, attacker, 'home-1', { x: 100, y: 100 }, 'hit');
  expect(a.planVersion).toBe(version);
  e.thought(a.id, 'pending', thinking.version, {
    plan: { intent: '旧回复', task: { kind: 'navigate', target: 'plaza', amount: 1 } },
  });
  expect(a.nextThink).toBe(w.time);
  expect(a.task).toBeUndefined();
  expect(e.events.some((v) => v.type === 'plan_rejected' && v.actor === a.id)).toBe(true);
  a.nextThink = DAY;
  hearDoorNoise(w, attacker, 'home-1', { x: 100, y: 100 }, 'broken');
  expect(a.nextThink).toBe(w.time);
});
it('noise starts before damage; a resident can choose to attack and interrupt an unfinished strike', () => {
  const w = world(),
    attacker = w.agents[28],
    defender = w.agents[7],
    house = w.stores.find((s) => s.id === 'home-1')!;
  Object.assign(attacker, { x: house.x, y: house.y + 8 });
  Object.assign(defender, { x: house.x, y: house.y + 5, grain: 0 });
  defender.routine.fetch = true;
  const initial = structuredClone(w),
    hp = house.lock!.hp,
    e = new ContinuousEngine(w);
  e.setPlan(attacker.id, {
    intent: '砸门',
    task: { kind: 'break_lock', target: house.id, amount: 1 },
  });
  expect(e.events.some((v) => v.type === 'door_noise' && v.listeners?.includes(defender.id))).toBe(
    true,
  );
  expect(house.lock!.hp).toBe(hp);
  e.setPlan(defender.id, {
    intent: '出战阻止',
    task: { kind: 'attack', target: `agent:${attacker.id}`, amount: 1 },
  });
  expect(defender.action?.operation?.kind).toBe('attack');
  e.advance(48 * 60000);
  expect(attacker.hp).toBeLessThan(100);
  expect(house.lock!.hp).toBe(hp);
  expect(attacker.action?.operation?.kind).not.toBe('break_lock');
  const replay = structuredClone(initial);
  e.events.forEach((v) => applyEvent(replay, v));
  replay.time = w.time;
  expect(replay).toEqual(w);
});
it('completed strikes and lock fracture are heard, but an already open door cannot be attacked', () => {
  const w = world(),
    a = w.agents[28],
    s = w.stores.find((s) => s.id === 'home-1')!;
  Object.assign(a, { x: s.x, y: s.y + 8 });
  s.lock!.hp = 12;
  const e = new ContinuousEngine(w);
  const strike = () =>
    e.setPlan(a.id, { intent: '砸门', task: { kind: 'break_lock', target: s.id, amount: 1 } });
  strike();
  e.advance(48 * 60000);
  expect(s.lock!.hp).toBe(6);
  strike();
  e.advance(96 * 60000);
  expect(s.lock!.locked).toBe(false);
  expect(e.events.filter((v) => v.type === 'door_noise')).toHaveLength(4);
  expect(e.events.filter((v) => v.type === 'door_noise').at(-1)?.text).toContain('断裂巨响');
  const count = e.events.filter((v) => v.type === 'door_noise').length;
  strike();
  e.advance(120 * 60000);
  expect(e.events.filter((v) => v.type === 'door_noise')).toHaveLength(count);
});
it('attack settlement cannot hit through a locked doorway without access', () => {
  const w = world(),
    a = w.agents[28],
    b = w.agents[7],
    s = w.stores.find((s) => s.id === 'home-1')!;
  Object.assign(a, { x: s.x, y: s.y + 8 });
  Object.assign(b, { x: s.x, y: s.y + 5 });
  expect(
    settleOperation(w, a, { kind: 'attack', target: `agent:${b.id}`, amount: 1 }).text,
  ).toContain('阻挡攻击');
  expect(b.hp).toBe(100);
});
