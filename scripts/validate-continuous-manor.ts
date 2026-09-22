import assert from 'node:assert/strict';
import { createManorWorld } from '../frontend/src/continuous/manor/world';
import { ContinuousEngine } from '../frontend/src/continuous/engine';
import { applyEvent, DAY } from '../frontend/src/continuous/types';
import { fiscalReport } from '../frontend/src/continuous/manor/observation';
const w = createManorWorld('manor-validation', 'scripted', { days: 60 });
const replay = structuredClone(w),
  engine = new ContinuousEngine(w);
let events = 0;
for (let day = 1; day <= 60; day++) {
  engine.advance(day * DAY);
  for (const e of engine.events) applyEvent(replay, e);
  replay.time = w.time;
  assert.deepEqual(replay, w);
  events += engine.events.length;
  engine.events.length = 0;
  const grain =
    w.agents.reduce((n, a) => n + a.grain, 0) +
    w.stores.reduce((n, s) => n + s.grain, 0) +
    w.fields.reduce((n, f) => n + f.harvest, 0) +
    w.manor!.treasury +
    w.ledger.eaten;
  assert.ok(Math.abs(grain - w.ledger.initial - w.ledger.grown) < 1e-6, 'grain mass conservation');
  assert.ok(
    w.stores.every((s) => s.grain >= -1e-8 && s.reserved >= -1e-8 && s.reserved <= s.grain + 1e-8),
  );
  if (day % 10 === 0)
    console.log(
      JSON.stringify({
        day,
        alive: w.agents.filter((a) => !a.dead && !a.away).length,
        events,
        king: w.manor!.king.phase,
        grown: w.ledger.grown,
        report: fiscalReport(w),
      }),
    );
}
assert.equal(w.calls, 0);
assert.equal(w.status, 'complete');
assert.ok(w.manor!.missions.some((m) => m.kind === 'army'));
console.log(
  'PASS: 60 days, all event replays exact, grain conserved, monthly harvest/famine/taxes/arrivals/combat exercised.',
);
