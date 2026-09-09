import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createWorld, hashWorld } from '../../src/sim/world';
import { nextTask, act, reflect, endDay } from '../../src/sim/engine';
import { makeRecord } from '../../src/runtime/model';
import { exportJournal } from '../../../scripts/journal';
export default async function setup() {
  execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/simulate.ts',
      '--overwrite',
      '--mode',
      'scripted',
      '--population',
      '5',
      '--days',
      '3',
      '--out',
      'artifacts/e2e-fixture',
    ],
    { stdio: 'pipe' },
  );
  // Put conversations beyond the default 120-row window in both storage modes.
  const folder = 'artifacts/e2e-search-fixture';
  fs.mkdirSync(folder, { recursive: true });
  const world = createWorld({ population: 5, days: 10 }, 'search-fixture');
  const snapshot = () => ({ seq: world.seq, day: world.tick, hash: hashWorld(world), world });
  fs.writeFileSync(`${folder}/snapshots.jsonl`, JSON.stringify(snapshot()) + '\n');
  fs.writeFileSync(`${folder}/events.jsonl`, '');
  fs.writeFileSync(`${folder}/decisions.jsonl`, '');
  while (world.cursor.phase !== 'complete') {
    const task = nextTask(world);
    let event;
    if (task) {
      const record = makeRecord(world, task);
      if (task.kind === 'action') {
        record.decision = {
          intent: '检索测试',
          action: world.seq < 2 ? { type: 'chat', text: '一起合作采集 ABC' } : { type: 'wait' },
        };
        event = act(world, task.agent.id, record.decision, task.id);
      } else {
        record.reflection = { summary: '整理经历', claims: [] };
        event = reflect(world, task.agent.id, record.reflection, task.id);
      }
      record.status = 'committed';
      fs.appendFileSync(`${folder}/decisions.jsonl`, JSON.stringify(record) + '\n');
    } else event = endDay(world);
    fs.appendFileSync(`${folder}/events.jsonl`, JSON.stringify(event) + '\n');
  }
  fs.appendFileSync(`${folder}/snapshots.jsonl`, JSON.stringify(snapshot()) + '\n');
  fs.writeFileSync(`${folder}/checkpoint.json`, JSON.stringify({ world, elapsedMs: 0 }));
  await exportJournal(folder, world);
}
