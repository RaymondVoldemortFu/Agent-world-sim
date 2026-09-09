import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { World, WorldEvent, DecisionRecord, Snapshot } from '../frontend/src/sim/types';
export async function* lines(file: string) {
  if (!fs.existsSync(file)) return;
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) yield line;
}
export async function repairJournal(folder: string, world: World) {
  const committed = new Set<string>();
  for (const name of ['events.jsonl', 'decisions.jsonl', 'snapshots.jsonl']) {
    const file = path.join(folder, name),
      temp = file + '.recover';
    const out = fs.createWriteStream(temp);
    for await (const line of lines(file)) {
      let item: any;
      try {
        item = JSON.parse(line);
      } catch {
        break;
      }
      const keep =
        name === 'events.jsonl'
          ? item.seq <= world.seq
          : name === 'decisions.jsonl'
            ? committed.has(item.id)
            : item.seq <= world.seq;
      if (keep) {
        if (name === 'events.jsonl') committed.add(item.decisionId);
        if (!out.write(line + '\n')) await once(out, 'drain');
      }
    }
    out.end();
    await once(out, 'finish');
    fs.renameSync(temp, file);
  }
  return committed;
}
export async function exportJournal(folder: string, world: World, elapsedMs = 0) {
  const out = fs.createWriteStream(path.join(folder, 'run.json.tmp'));
  const write = async (s: string) => {
    if (!out.write(s)) await once(out, 'drain');
  };
  const committed = new Set<string>();
  await write(
    '{"format":"agent-world-v1","elapsedMs":' +
      JSON.stringify(elapsedMs) +
      ',"world":' +
      JSON.stringify(world),
  );
  for (const [key, name] of [
    ['events', 'events.jsonl'],
    ['decisions', 'decisions.jsonl'],
    ['snapshots', 'snapshots.jsonl'],
  ]) {
    await write(`,"${key}":[`);
    let first = true;
    for await (const line of lines(path.join(folder, name))) {
      const item = JSON.parse(line) as WorldEvent & DecisionRecord & Snapshot;
      const keep = key === 'decisions' ? committed.has(item.id) : item.seq <= world.seq;
      if (!keep) continue;
      if (key === 'events') committed.add(item.decisionId);
      await write((first ? '' : ',') + line);
      first = false;
    }
    await write(']');
  }
  await write('}');
  out.end();
  await once(out, 'finish');
  fs.renameSync(path.join(folder, 'run.json.tmp'), path.join(folder, 'run.json'));
}
