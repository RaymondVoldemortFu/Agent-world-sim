import fs from 'node:fs';
import path from 'node:path';
import { lines } from './journal';
import { applyEvent } from '../frontend/src/sim/engine';
import { hashWorld, weight } from '../frontend/src/sim/world';
import type { World, WorldEvent, Snapshot } from '../frontend/src/sim/types';
const folder = path.resolve(process.argv[2] ?? 'artifacts/scripted-compact');
const checkpoint = JSON.parse(fs.readFileSync(path.join(folder, 'checkpoint.json'), 'utf8'));
const snapshots = new Map<number, Snapshot>();
for await (const line of lines(path.join(folder, 'snapshots.jsonl'))) {
  const s = JSON.parse(line);
  snapshots.set(s.seq, s);
}
const initial = snapshots.get(0);
if (!initial) throw new Error('Initial snapshot missing');
let w: World = structuredClone(initial.world);
if (hashWorld(w) !== initial.hash) throw new Error('Invalid initial hash');
let events = 0,
  verified = 1;
const ids = new Set<string>();
for await (const line of lines(path.join(folder, 'events.jsonl'))) {
  const e = JSON.parse(line) as WorldEvent;
  if (e.seq > checkpoint.world.seq) break;
  if (ids.has(e.decisionId)) throw new Error(`Duplicate decision ${e.decisionId}`);
  ids.add(e.decisionId);
  applyEvent(w, e);
  events++;
  for (const a of w.agents) {
    if (
      a.hp < 0 ||
      a.hp > 100 ||
      a.hunger < 0 ||
      a.hunger > 100 ||
      weight(a.inventory) > 12 ||
      Object.values(a.inventory).some((n) => !Number.isInteger(n) || n! < 0)
    )
      throw new Error(`Agent invariant broken at event ${e.seq}`);
  }
  for (const t of e.patch.tiles) {
    if (
      t.farmFood < 0 ||
      Object.values(t.resources).some((n) => n! < 0) ||
      Object.values(t.ground).some((n) => n! < 0)
    )
      throw new Error(`Tile invariant broken at event ${e.seq}`);
  }
  const s = snapshots.get(e.seq);
  if (s) {
    if (hashWorld(w) !== s.hash) throw new Error(`Replay diverged at snapshot ${e.seq}`);
    verified++;
  }
}
if (hashWorld(w) !== hashWorld(checkpoint.world))
  throw new Error('Final world differs from replay');
const result = {
  ok: true,
  events,
  snapshots: verified,
  days: w.metrics.length,
  finalHash: hashWorld(w),
};
fs.writeFileSync(path.join(folder, 'verification.json'), JSON.stringify(result, null, 2));
console.log(result);
