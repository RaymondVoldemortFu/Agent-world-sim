import fs from 'node:fs';
import path from 'node:path';
import { lines } from './journal';
import { nextTask, observe, applyEvent } from '../frontend/src/sim/engine';
import type { DecisionRecord, World, WorldEvent } from '../frontend/src/sim/types';
const folder = path.resolve(process.argv[2] ?? 'artifacts/llm-baseline');
const checkpoint = JSON.parse(fs.readFileSync(path.join(folder, 'checkpoint.json'), 'utf8'));
const repair = process.argv.includes('--repair');
if (repair && checkpoint.world.cursor.phase !== 'complete')
  throw new Error('Context repair requires a completed experiment');
const replacements = new Map<string, unknown>();
const records = new Map<string, DecisionRecord>();
for await (const line of lines(path.join(folder, 'decisions.jsonl'))) {
  try {
    const r = JSON.parse(line);
    records.set(r.id, r);
  } catch {
    break;
  }
}
let world: World | undefined;
for await (const line of lines(path.join(folder, 'snapshots.jsonl'))) {
  const s = JSON.parse(line);
  if (s.seq === 0) {
    world = s.world;
    break;
  }
}
if (!world) throw new Error('Missing initial snapshot');
const mismatches: { id: string; seq: number; day: number; fields: string[] }[] = [];
let checked = 0;
for await (const line of lines(path.join(folder, 'events.jsonl'))) {
  let e: WorldEvent;
  try {
    e = JSON.parse(line);
  } catch {
    break;
  }
  if (e.seq > checkpoint.world.seq) break;
  const r = records.get(e.decisionId);
  if (r) {
    const task = nextTask(world);
    if (!task || task.id !== r.id) throw new Error(`Unexpected decision order at ${e.seq}`);
    const expected = JSON.parse(JSON.stringify(observe(world, task.agent)));
    const actual = r.context as Record<string, unknown>;
    const fields = Object.keys(expected).filter(
      (k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]),
    );
    checked++;
    if (fields.length && repair)
      replacements.set(r.id, {
        ...r,
        context: expected,
        originalSavedContext: r.context,
        contextSource: 'reconstructed-from-events',
      });
    if (fields.length) mismatches.push({ id: r.id, seq: e.seq, day: e.day, fields });
  }
  applyEvent(world, e);
}
const result = {
  checked,
  throughSeq: checkpoint.world.seq,
  mismatches: mismatches.length,
  firstMismatch: mismatches[0],
  lastMismatch: mismatches.at(-1),
  examples: mismatches.slice(0, 10),
};
fs.writeFileSync(path.join(folder, 'context-audit.json'), JSON.stringify(result, null, 2));
console.log(result);

if (repair && replacements.size) {
  fs.writeFileSync(
    path.join(folder, 'context-audit.reconstruction.json'),
    JSON.stringify(result, null, 2),
  );
  const source = path.join(folder, 'decisions.jsonl');
  const backup = path.join(folder, 'decisions.original.jsonl');
  if (fs.existsSync(backup))
    throw new Error('Original decision backup already exists; refusing to overwrite');
  fs.copyFileSync(source, backup);
  const target = fs.openSync(source + '.reconstructed', 'w');
  try {
    for await (const line of lines(source)) {
      const r = JSON.parse(line);
      fs.writeSync(target, JSON.stringify(replacements.get(r.id) ?? r) + '\n');
    }
  } finally {
    fs.closeSync(target);
  }
  fs.renameSync(source + '.reconstructed', source);
  console.log(
    `Reconstructed ${replacements.size} historical contexts; original journal preserved.`,
  );
}
