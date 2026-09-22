import { describe, it, expect } from 'vitest';
import { createGameWorld } from '../src/continuous/game/world';
import { ContinuousEngine, route } from '../src/continuous/engine';
import {
  buildings,
  solids,
  segmentClear,
  collides,
  interactionPoint,
} from '../src/continuous/game/space';
import { actionDuration } from '../src/continuous/game/rules';
import { present } from '../src/continuous/game/presentation';
import { DAY, SPEED, position, applyEvent } from '../src/continuous/types';

function quiet() {
  const w = createGameWorld('game');
  for (const a of w.agents) {
    a.routine = { eat: false, fetch: false, work: false, reserveDays: 7 };
    delete a.task;
  }
  return w;
}
describe('authoritative game engine', () => {
  it('routes through real doorways, with clearance from plaster and stone walls', () => {
    const w = quiet(),
      a = w.agents[0];
    for (const target of w.sites) {
      const path = route(w, a, target);
      expect(path, target.id).toBeDefined();
      const obstacles = solids(w, a.keys);
      for (let i = 1; i < path!.length; i++)
        expect(segmentClear(path![i - 1], path![i], obstacles), target.id).toBe(true);
      expect(path!.at(-1)).toEqual({ ...interactionPoint(w, { x: target.x, y: target.y }) });
    }
    const b = buildings(w)[0];
    expect(route(w, a, { x: b.x - b.w / 2, y: b.y })).toBeUndefined();
    w.gates[0].open = false;
    expect(route(w, a, w.sites[0])).toBeUndefined();
    expect(route(w, w.agents[1], w.sites[0])).toBeDefined();
  });
  it('uses visible real-time movement and can interrupt midway without teleporting', () => {
    const w = quiet(),
      e = new ContinuousEngine(w),
      a = w.agents[0];
    e.setPlan(1, { intent: '步行到家', task: { kind: 'navigate', target: a.home, amount: 1 } });
    const m = a.motion!;
    expect((m.end - m.start) / SPEED / 1000).toBeGreaterThan(1);
    e.advance(m.end / 2);
    const p = position(a, w.time);
    expect(collides(p, solids(w, a.keys))).toBe(false);
    e.setPlan(1, { intent: '改变目的地', task: { kind: 'navigate', target: 'plaza', amount: 1 } });
    expect(a.motion!.points[0]).toEqual(p);
    e.setPlan(1, { intent: '留在原地', task: null });
    expect(position(a, w.time)).toEqual(p);
    expect(actionDuration(w, 'speech', 3000) / SPEED).toBeGreaterThanOrEqual(3000);
  });
  it('closing a gate cancels paths crossing the doorway and automatic meals fill satiety', () => {
    const w = quiet(),
      a = w.agents[0],
      e = new ContinuousEngine(w),
      gate = w.gates[0];
    a.x = gate.x - 12;
    a.y = gate.y;
    e.setPlan(a.id, { intent: '进大厅', task: { kind: 'navigate', target: 'hall', amount: 1 } });
    expect(a.motion).toBeDefined();
    e.gate(gate.id, false);
    expect(a.motion).toBeUndefined();
    expect(a.blocked?.reason).toContain('路径');
    e.setPlan(a.id, {
      intent: '先吃饱',
      task: null,
      routine: { eat: true, fetch: false, work: false, reserveDays: 7 },
    });
    // Start a separate meal fixture with no preexisting action or reservation.
    const hungry = quiet();
    hungry.agents[0].food = 1000;
    hungry.agents[0].grain = 5;
    hungry.agents[0].routine.eat = true;
    const meal = new ContinuousEngine(hungry);
    meal.advance(actionDuration(hungry, 'eat', 5 * 60000));
    expect(hungry.agents[0].food).toBeCloseTo(5000);
  });
  it('keeps replay and step-size invariance with the new navigation and pacing', () => {
    const initial = createGameWorld('replay'),
      a = new ContinuousEngine(structuredClone(initial)),
      b = new ContinuousEngine(structuredClone(initial));
    a.advance(DAY);
    for (let t = 271000; t < DAY; t += 271000) b.advance(t);
    b.advance(DAY);
    expect(b.world).toEqual(a.world);
    const replay = structuredClone(initial);
    for (const e of a.events) applyEvent(replay, e);
    replay.time = a.world.time;
    expect(replay).toEqual(a.world);
    expect(a.world.agents.every((a) => a.grain >= 0)).toBe(true);
    expect(a.world.stores.every((s) => s.grain >= s.reserved - 1e-8)).toBe(true);
  });
  it('renders only committed frames and freezes at pause or replay', () => {
    const a = quiet(),
      b = structuredClone(a);
    a.time = 100000;
    b.time = 200000;
    const frames = [
      { world: a, at: 100 },
      { world: b, at: 200 },
    ];
    expect(present(frames, 300)!.time).toBeLessThanOrEqual(b.time);
    expect(present(frames, 999999)!.time).toBe(b.time);
    b.status = 'paused';
    expect(present(frames, 400)!.time).toBe(b.time);
    expect(present(frames, 999999, a)).toEqual({ world: a, time: a.time });
  });
});
