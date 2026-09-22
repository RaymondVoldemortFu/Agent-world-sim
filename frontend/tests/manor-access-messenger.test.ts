import { expect, it } from 'vitest';
import { ContinuousEngine, route } from '../src/continuous/engine';
import { DAY, RATION, applyEvent, type Task } from '../src/continuous/types';
import { createManorWorld } from '../src/continuous/manor/world';
import {
  accessible,
  settleOperation,
  spawnRoyal,
  validateOperation,
} from '../src/continuous/manor/rules';
import { deliverLetters } from '../src/continuous/manor/letters';
import { manorObservation } from '../src/continuous/manor/observation';
const world = () => createManorWorld('access-messenger', 'llm');
it('a physical key holder can grant only one door; access expires and cannot be delegated', () => {
  const w = world(),
    owner = w.agents[0],
    guest = w.agents[28];
  const keep = w.stores.find((s) => s.id === 'keep-store')!;
  const tax = w.stores.find((s) => s.id === 'royal-tax-store')!;
  keep.lock!.locked = tax.lock!.locked = true;
  Object.assign(owner, { x: keep.x, y: keep.y + 11 });
  Object.assign(guest, { x: keep.x, y: keep.y + 12 });
  expect(route(w, guest, keep)).toBeUndefined();
  const task: Task = { kind: 'grant_access', target: keep.id, item: 'agent:29', amount: 1 };
  expect(settleOperation(w, owner, task).listeners).toEqual([29]);
  expect(accessible(keep, guest, w.time)).toBe(true);
  expect(accessible(tax, guest, w.time)).toBe(false);
  expect(route(w, guest, keep)).toBeDefined();
  expect(guest.keys).not.toContain('key_keep');
  expect(validateOperation(w, guest, { ...task, item: 'agent:1' })).toContain('实际钥匙');
  expect(validateOperation(w, guest, { kind: 'unlock', target: keep.id, amount: 1 })).toBeTruthy();
  w.time = DAY * 1.5;
  expect(accessible(keep, guest, w.time)).toBe(false);
  expect(route(w, guest, keep)).toBeUndefined();
});
it('grant requires nearby living recipient and settles through the engine with replayable expiry', () => {
  const w = world(),
    owner = w.agents[0],
    guest = w.agents[28],
    gate = w.gates[0];
  Object.assign(owner, { x: gate.x - 4, y: gate.y });
  Object.assign(guest, { x: gate.x - 6, y: gate.y });
  const task: Task = { kind: 'grant_access', target: gate.id, item: 'agent:29', amount: 1 };
  guest.x -= 30;
  expect(validateOperation(w, owner, task)).toContain('12米');
  guest.x += 30;
  const initial = structuredClone(w),
    e = new ContinuousEngine(w);
  e.setPlan(1, { intent: '带牧钟母进门', task });
  e.advance(DAY / 24);
  expect(guest.doorAccess?.[0].door).toBe(gate.id);
  const expiry = guest.doorAccess![0].until;
  e.advance(expiry);
  expect(guest.doorAccess).toEqual([]);
  expect(
    e.events.some((v) => v.actor === 29 && v.type === 'access_expired' && v.time === expiry),
  ).toBe(true);
  const replay = structuredClone(initial);
  e.events.forEach((v) => applyEvent(replay, v));
  replay.time = w.time;
  expect(replay).toEqual(w);
});
it('steward household letters arrive one hour after writing, while other mail remains intercepted', () => {
  const w = world(),
    steward = w.agents[2];
  for (const id of [1, 2, 4, 32])
    settleOperation(w, steward, {
      kind: 'write_letter',
      target: `agent:${id}`,
      text: '速报',
      amount: 1,
    });
  settleOperation(w, w.agents[7], {
    kind: 'write_letter',
    target: 'agent:1',
    text: '农民报信',
    amount: 1,
  });
  w.time = DAY / 24 - 1;
  expect(deliverLetters(w)).toEqual([]);
  w.time++;
  expect(deliverLetters(w)).toHaveLength(4);
  expect(
    w.manor!.letters!.slice(0, 4).every((l) => l.status === 'delivered' && l.holder === l.to),
  ).toBe(true);
  expect(w.manor!.letters![4].status).toBe('transit');
  w.time = DAY;
  deliverLetters(w);
  expect(w.manor!.letters![4]).toMatchObject({ status: 'held', holder: 3 });
});
it('messenger waits for actual tax settlement, shouts once then leaves, rejecting late plans', () => {
  const w = world();
  w.manor!.king.arrears = 10;
  spawnRoyal(w, 'messenger', 1);
  const messenger = w.agents.at(-1)!;
  const plaza = w.sites.find((s) => s.id === 'plaza')!;
  Object.assign(messenger, { x: plaza.x, y: plaza.y });
  w.stores.find((s) => s.id === 'royal-tax-store')!.grain = 10 * RATION;
  const initial = structuredClone(w),
    e = new ContinuousEngine(w);
  e.advance(DAY / 2);
  expect(w.manor!.missions[0].taxPaidAt).toBeUndefined();
  e.advance(DAY);
  expect(w.manor!.king.arrears).toBeLessThan(1e-7);
  expect(messenger.voice).toMatchObject({ mode: 'shout', text: '税收齐了' });
  expect(messenger.motion).toBeUndefined();
  expect(
    e.setPlan(
      messenger.id,
      { intent: '继续调查', task: { kind: 'navigate', target: 'plaza', amount: 1 } },
      'llm',
      0,
    ),
  ).toBe(false);
  e.advance(DAY * 2);
  expect(messenger.away).toBe(true);
  expect(w.manor!.missions[0].finished).toBe(true);
  expect(
    e.events.filter(
      (v) => v.actor === messenger.id && v.type === 'speech' && v.text === '税收齐了',
    ),
  ).toHaveLength(1);
  expect(messenger.systemMemory).toHaveLength(2);
  expect(manorObservation(w, messenger)).toContain('已到达exit并离开领地');
  const replay = structuredClone(initial);
  e.events.forEach((v) => applyEvent(replay, v));
  replay.time = w.time;
  expect(replay).toEqual(w);
});
it('a returning messenger can break an obstructing locked door and does not get stuck inside the manor', () => {
  const w = world();
  spawnRoyal(w, 'messenger', 1);
  const a = w.agents.at(-1)!,
    hall = w.stores.find((s) => s.id === 'keep-store')!;
  Object.assign(a, { x: hall.x, y: hall.y });
  hall.lock!.locked = true;
  const e = new ContinuousEngine(w);
  e.advance(DAY * 3);
  expect(a.away).toBe(true);
  expect(hall.lock!.locked).toBe(false);
  expect(
    e.events.some((v) => v.actor === a.id && v.type === 'estate' && v.text.includes('破')),
  ).toBe(true);
});
