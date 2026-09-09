import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { repairJournal, exportJournal } from './journal';
import { createWorld, hashWorld, living, tileAt, count, weight } from '../frontend/src/sim/world';
import { act, endDay, nextTask, reflect, metrics } from '../frontend/src/sim/engine';
import { nextBatch } from '../frontend/src/sim/scheduler';
import {
  account,
  budgetReason,
  makeRecord,
  prepareRecord,
  requestDecision,
} from '../frontend/src/runtime/model';
import {
  type World,
  type Decision,
  type DecisionRecord,
  type WorldEvent,
  type Snapshot,
  type Config,
} from '../frontend/src/sim/types';
const args = process.argv.slice(2);
const arg = (k: string, def: string) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? def : args[i + 1];
};
const mode = arg('mode', 'scripted');
const out = path.resolve(arg('out', `artifacts/${mode}-${Date.now()}`));
fs.mkdirSync(out, { recursive: true });
const file = (n: string) => path.join(out, n);
if (!['llm', 'scripted'].includes(mode)) throw new Error('--mode must be llm or scripted');
const lockFile = file('runner.lock');
if (fs.existsSync(lockFile)) {
  const owner = Number(fs.readFileSync(lockFile, 'utf8'));
  let alive = true;
  if (!Number.isInteger(owner) || owner <= 0)
    throw new Error('Output directory is being initialized by another process');
  try {
    process.kill(owner, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
  }
  if (alive) throw new Error(`Experiment already has an active writer (PID ${owner})`);
  fs.unlinkSync(lockFile);
}
fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
process.on('exit', () => {
  try {
    if (fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(lockFile);
  } catch {}
});
if (args.includes('--resume') && !fs.existsSync(file('checkpoint.json')))
  throw new Error('No checkpoint to resume');
if (
  !args.includes('--resume') &&
  fs.existsSync(file('checkpoint.json')) &&
  !args.includes('--overwrite')
)
  throw new Error(
    'Output already exists; use --resume or choose a new output directory (--overwrite explicitly replaces this experiment)',
  );
const write = (name: string, data: unknown) => {
  fs.writeFileSync(file(name + '.tmp'), JSON.stringify(data));
  fs.renameSync(file(name + '.tmp'), file(name));
};
const config: Partial<Config> = {
  days: Number(arg('days', '100')),
  population: Number(arg('population', '20')),
  seed: Number(arg('seed', '20260909')),
};
let w: World;
let pending: DecisionRecord | undefined;
let elapsed = 0;
if (args.includes('--resume') && fs.existsSync(file('checkpoint.json'))) {
  const c = JSON.parse(fs.readFileSync(file('checkpoint.json'), 'utf8'));
  w = c.world;
  elapsed = c.elapsedMs;
  if (fs.existsSync(file('pending.json')))
    pending = JSON.parse(fs.readFileSync(file('pending.json'), 'utf8'));
  const committed = await repairJournal(out, w);
  if (pending && committed.has(pending.id)) pending = undefined;
  console.log(`RESUME ${out} day=${w.tick} seq=${w.seq}`);
} else {
  w = createWorld(config, `${mode}-${Date.now()}`);
  const initial = { seq: 0, day: 1, hash: hashWorld(w), world: structuredClone(w) };
  fs.writeFileSync(file('snapshots.jsonl'), JSON.stringify(initial) + '\n');
  fs.writeFileSync(file('events.jsonl'), '');
  fs.writeFileSync(file('decisions.jsonl'), '');
  write('checkpoint.json', { world: w, elapsedMs: 0 });
}
fs.appendFileSync(
  file('implementation.jsonl'),
  JSON.stringify({
    at: new Date().toISOString(),
    afterSeq: w.seq,
    execution: { concurrency: Number(arg('concurrency', '6')), scheduler: 'contiguous-spatial-v1' },
    files: Object.fromEntries(
      [
        'frontend/src/sim/scheduler.ts',
        'frontend/src/sim/engine.ts',
        'frontend/src/sim/world.ts',
        'frontend/src/runtime/model.ts',
        'backend/app/main.py',
      ].map((p) => [p, createHash('sha256').update(fs.readFileSync(p)).digest('hex')]),
    ),
  }) + '\n',
);
const concurrency = Math.max(1, Math.min(16, Number(arg('concurrency', '6'))));
if (!Number.isInteger(concurrency)) throw new Error('Invalid concurrency');
fs.mkdirSync(file('pending'), { recursive: true });
const pendingFile = (id: string) =>
  'pending/' + createHash('sha256').update(id).digest('hex') + '.json';
const started = Date.now();
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
  console.log('Stopping at next committed boundary…');
});
function scripted(w: World, id: number): Decision {
  const a = w.agents.find((a) => a.id === id)!;
  const t = tileAt(w, a.x, a.y);
  let action: Decision['action'] = { type: 'wait' };
  if (a.hunger <= 60 && count(a.inventory, 'food'))
    action = {
      type: 'eat',
      quantity: Math.min(3, count(a.inventory, 'food'), Math.ceil((100 - a.hunger) / 20)),
    };
  else if (weight(a.inventory) < 10 && (t.farm >= 3 ? t.farmFood : count(t.resources, 'food')) > 0)
    action = t.farm >= 3 ? { type: 'harvest' } : { type: 'gather', resource: 'food' };
  else {
    const candidates = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ dx, dy, t: tileAt(w, a.x + dx, a.y + dy) }))
      .filter((x) => x.t && x.t.x === a.x + x.dx && x.t.y === a.y + x.dy);
    candidates.sort((x, y) => count(y.t.resources, 'food') - count(x.t.resources, 'food'));
    if (candidates.length) action = { type: 'move', dx: candidates[0].dx, dy: candidates[0].dy };
  }
  return { intent: '脚本基线：维持生存与资源循环', action };
}
function append(name: string, data: unknown) {
  fs.appendFileSync(file(name), JSON.stringify(data) + '\n');
}
let reason = '';
try {
  while (w.cursor.phase !== 'complete' && !stopped) {
    reason = budgetReason(w, elapsed + Date.now() - started) ?? '';
    if (reason) break;
    const tasks = nextBatch(
      w,
      mode === 'llm' ? Math.min(concurrency, Math.max(1, w.config.maxCalls - w.usage.calls)) : 1,
    );
    let event: WorldEvent;
    if (tasks.length) {
      const outcomes = await Promise.allSettled(
        tasks.map(async (task) => {
          const path = file(pendingFile(task.id));
          const saved = fs.existsSync(path)
            ? JSON.parse(fs.readFileSync(path, 'utf8'))
            : pending?.id === task.id
              ? pending
              : undefined;
          let record = prepareRecord(w, task, saved);
          if (mode === 'llm')
            record = await requestDecision(
              record,
              async (r) => write(pendingFile(r.id), r),
              arg('api', 'http://127.0.0.1:8000'),
            );
          else {
            if (task.kind === 'action') record.decision = scripted(w, task.agent.id);
            else record.reflection = { summary: '记录近期生存经历。', claims: [] };
            record.status = 'received';
          }
          return record;
        }),
      );
      const failure = outcomes.find((r) => r.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const records = outcomes.map((r) => (r as PromiseFulfilledResult<DecisionRecord>).value);
      for (let i = 0; i < records.length; i++) {
        const record = records[i],
          task = nextTask(w);
        if (!task || task.id !== record.id) throw new Error('Parallel commit order mismatch');
        if (record.fatal) {
          reason = record.fatal;
          break;
        }
        account(w, record);
        event =
          task.kind === 'action'
            ? act(w, task.agent.id, record.decision!, task.id)
            : reflect(w, task.agent.id, record.reflection!, task.id);
        record.status = 'committed';
        append('decisions.jsonl', record);
        append('events.jsonl', event);
        write('checkpoint.json', { world: w, elapsedMs: elapsed + Date.now() - started });
        if (fs.existsSync(file(pendingFile(record.id))))
          fs.unlinkSync(file(pendingFile(record.id)));
        if (pending?.id === record.id) {
          pending = undefined;
          if (fs.existsSync(file('pending.json'))) fs.unlinkSync(file('pending.json'));
        }
      }
      if (reason) break;
      continue;
    }
    event = endDay(w);
    append('events.jsonl', event);
    write('checkpoint.json', { world: w, elapsedMs: elapsed + Date.now() - started });
    if (event.type === 'day_end') {
      if (event.day % 5 === 0 || (w.cursor.phase as string) === 'complete')
        append('snapshots.jsonl', {
          seq: w.seq,
          day: event.day,
          hash: hashWorld(w),
          world: structuredClone(w),
        } satisfies Snapshot);
      console.log(
        JSON.stringify({
          ...metrics(w),
          day: event.day,
          seq: w.seq,
          elapsedSeconds: Math.round((elapsed + Date.now() - started) / 1000),
        }),
      );
    }
  }
} catch (e) {
  reason = e instanceof Error ? e.message : String(e);
  process.exitCode = 1;
  console.error(reason);
}
// Export only the durable checkpoint and its journal prefix. Streaming avoids the JS string limit.
const checkpoint = JSON.parse(fs.readFileSync(file('checkpoint.json'), 'utf8'));
w = checkpoint.world;
write('summary.json', {
  mode,
  status: w.cursor.phase === 'complete' ? 'complete' : 'paused',
  reason,
  daysCompleted: w.metrics.length,
  seed: w.config.seed,
  initialPopulation: w.config.population,
  alive: living(w).length,
  usage: w.usage,
  counters: w.counters,
  hash: hashWorld(w),
  elapsedMs: checkpoint.elapsedMs,
  concurrency,
});
await exportJournal(out, w, checkpoint.elapsedMs);
console.log(`RESULT ${file('summary.json')} ${reason}`);
