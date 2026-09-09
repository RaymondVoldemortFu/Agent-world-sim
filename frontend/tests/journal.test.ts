import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, nextTask } from '../src/sim/engine';
import { makeRecord } from '../src/runtime/model';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repairJournal, exportJournal } from '../../scripts/journal';
it('recovery discards only the uncommitted journal suffix', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-recovery-'));
  try {
    const w = createWorld({ size: 16, population: 1 }, 'recovery'),
      initial = { seq: 0, day: 1, hash: hashWorld(w), world: structuredClone(w) };
    const first = act(w, 1, { intent: '', action: { type: 'wait' } }, 'one');
    const committed = structuredClone(w);
    const second = act(w, 1, { intent: '', action: { type: 'wait' } }, 'two');
    fs.writeFileSync(
      path.join(folder, 'events.jsonl'),
      JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n{"partial":',
    );
    fs.writeFileSync(
      path.join(folder, 'decisions.jsonl'),
      JSON.stringify({ id: 'one' }) + '\n' + JSON.stringify({ id: 'two' }) + '\n',
    );
    fs.writeFileSync(path.join(folder, 'snapshots.jsonl'), JSON.stringify(initial) + '\n');
    const ids = await repairJournal(folder, committed);
    expect([...ids]).toEqual(['one']);
    expect(
      fs.readFileSync(path.join(folder, 'events.jsonl'), 'utf8').trim().split('\n'),
    ).toHaveLength(1);
    await exportJournal(folder, committed);
    const bundle = JSON.parse(fs.readFileSync(path.join(folder, 'run.json'), 'utf8'));
    expect(bundle.events).toHaveLength(1);
    expect(bundle.decisions).toEqual([{ id: 'one' }]);
    expect(bundle.world.seq).toBe(1);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

it('historical context reconstruction preserves original records', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-context-'));
  try {
    const w = createWorld({ size: 16, population: 1, days: 1 }, 'context-test');
    const initial = { seq: 0, day: 1, hash: hashWorld(w), world: structuredClone(w) };
    const events = [],
      records = [];
    while (w.cursor.phase !== 'complete') {
      const task = nextTask(w);
      if (task) {
        const r = makeRecord(w, task);
        r.decision = { intent: '', action: { type: 'wait' } };
        events.push(act(w, task.agent.id, r.decision, task.id));
        r.status = 'committed';
        records.push(r);
      } else events.push(endDay(w));
    }
    (records[0].context as any).self.hunger = 999;
    fs.writeFileSync(
      path.join(folder, 'checkpoint.json'),
      JSON.stringify({ world: w, elapsedMs: 0 }),
    );
    fs.writeFileSync(
      path.join(folder, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(folder, 'decisions.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    fs.writeFileSync(path.join(folder, 'snapshots.jsonl'), JSON.stringify(initial) + '\n');
    execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/audit-contexts.ts', folder, '--repair'],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'pipe' },
    );
    const first = JSON.parse(
      fs.readFileSync(path.join(folder, 'decisions.jsonl'), 'utf8').split('\n')[0],
    );
    expect(first.context.self.hunger).toBe(100);
    expect(first.originalSavedContext.self.hunger).toBe(999);
    expect(first.contextSource).toBe('reconstructed-from-events');
    expect(fs.existsSync(path.join(folder, 'decisions.original.jsonl'))).toBe(true);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
