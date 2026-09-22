import { expect, it } from 'vitest';
import { createGameWorld } from '../src/continuous/game/world';
import { ContinuousEngine, route } from '../src/continuous/engine';
import { eventFrame, mergeEvents } from '../src/continuous/game/history';
import { applyEvent, DAY, type Event } from '../src/continuous/types';
import { segmentClear, CLEARANCE, type Solid } from '../src/continuous/game/space';

it('shares static frame data without mutating historical frames or event payloads', () => {
  const original = createGameWorld('frames');
  const engine = new ContinuousEngine(structuredClone(original));
  engine.advance(DAY / 8);
  let frame = original,
    replay = structuredClone(original);
  const first = structuredClone(original);
  for (const event of engine.events) {
    const prior = frame,
      saved = structuredClone(prior);
    frame = eventFrame(frame, event);
    applyEvent(replay, event);
    expect(frame).toEqual(replay);
    expect(prior).toEqual(saved);
    expect(frame.sites).toBe(original.sites);
  }
  expect(original).toEqual(first);
  expect(mergeEvents(engine.events.slice(-5), engine.events.slice(-3)).length).toBe(5);
});
it('preserves exact collision decisions including boundary contacts', () => {
  const old = (a: { x: number; y: number }, b: { x: number; y: number }, list: Solid[]) =>
    !list.some((s) => {
      let lo = 0,
        hi = 1;
      for (const [p, v, min, max] of [
        [a.x, b.x - a.x, s.x - s.w / 2 - CLEARANCE, s.x + s.w / 2 + CLEARANCE],
        [a.y, b.y - a.y, s.y - s.d / 2 - CLEARANCE, s.y + s.d / 2 + CLEARANCE],
      ]) {
        if (Math.abs(v) < 1e-10) {
          if (p < min || p > max) return false;
        } else {
          let t0 = (min - p) / v,
            t1 = (max - p) / v;
          if (t0 > t1) [t0, t1] = [t1, t0];
          lo = Math.max(lo, t0);
          hi = Math.min(hi, t1);
          if (lo > hi) return false;
        }
      }
      return true;
    });
  const list = [
    { x: 8, y: 12, w: 3, d: 6 },
    { x: 0, y: 0, w: 1, d: 1 },
  ];
  for (let i = 0; i < 1500; i++) {
    const a = { x: (i % 53) / 2 - 5, y: (i % 37) / 2 - 5 },
      b = { x: (i % 29) / 2, y: (i % 41) / 2 };
    expect(segmentClear(a, b, list)).toBe(old(a, b, list));
  }
});
it('invalidates cached clearance when a gate closes or a key changes', () => {
  const w = createGameWorld('doors');
  const a = w.agents[0],
    hall = w.sites.find((s) => s.id === 'hall')!;
  expect(route(w, a, hall)).toBeDefined();
  w.gates[0].open = false;
  expect(route(w, a, hall)).toBeUndefined();
  a.keys.push(w.gates[0].key);
  expect(route(w, a, hall)).toBeDefined();
  a.keys = [];
  expect(route(w, a, hall)).toBeUndefined();
});
