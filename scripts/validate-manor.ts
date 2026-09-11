/** Offline integration baseline: no provider requests and no database mutation. */
import fs from 'node:fs';
import { createWorld } from '../frontend/src/sim/world';
import { nextTask, act, endDay } from '../frontend/src/sim/engine';
import { observeEco } from '../frontend/src/ecology/engine';
import { ruleDecision } from '../frontend/src/brain/controller';
import { validateEcology } from '../frontend/src/ecology/invariants';
import { MANOR_CONFIG } from '../frontend/src/manor/world';
const days = Number(process.argv[2] ?? 120);
const w = createWorld({ ...MANOR_CONFIG, days, llmDailyCalls: 0 }, 'manor-offline-validation');
const counts: Record<string, number> = {},
  failures: Record<string, number> = {};
let steps = 0;
validateEcology(w);
while (w.cursor.phase !== 'complete') {
  const t = nextTask(w);
  const event = t ? act(w, t.agent.id, ruleDecision(observeEco(w, t.agent)), t.id) : endDay(w);
  counts[event.type] = (counts[event.type] ?? 0) + 1;
  if (!event.success)
    failures[event.text.replace(/^.*? #\d+ /, '')] =
      (failures[event.text.replace(/^.*? #\d+ /, '')] ?? 0) + 1;
  if (event.type === 'day_end') {
    validateEcology(w);
    if (event.day % 30 === 0)
      process.stdout.write(
        `Day ${event.day}: alive ${w.agents.filter((a) => !a.death && !a.away).length}\n`,
      );
  }
  if (++steps > 1000000) throw Error('Integration exceeded bounded action count');
}
fs.mkdirSync('artifacts/manor-validation', { recursive: true });
const summary = {
  days,
  steps,
  counts,
  failures,
  harvests: w.manor!.harvests,
  king: w.manor!.king,
  aliveResidents: w.agents.filter((a) => !a.death && a.id <= 31).length,
  usage: w.usage,
  history: w.manor!.history,
};
fs.writeFileSync('artifacts/manor-validation/report.json', JSON.stringify(summary, null, 2));
fs.writeFileSync('artifacts/manor-validation/world.json', JSON.stringify(w));
console.log(JSON.stringify(summary, null, 2));
