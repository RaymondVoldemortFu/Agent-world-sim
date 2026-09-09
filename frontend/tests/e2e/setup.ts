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
  const world = createWorld({ population: 5, days: 10, dailyAP: 4 }, 'search-fixture');
  // Historical search fixture isolates pagination from new survival rules.
  world.rulesVersion = 'mvp-1.3.0';
  world.agents.forEach((a) => {
    delete a.social;
    delete a.role;
    a.recipes = [];
  });
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
  const shoutWorld = createWorld({ population: 3, days: 1 }, 'shout-fixture');
  shoutWorld.agents.forEach((a, i) => {
    a.x = 3 + i * 2;
    a.y = 3;
  });
  shoutWorld.agents[0].social = { loneliness: 40, lastSpokeDay: 0, depressed: true };
  const shoutInitial = structuredClone(shoutWorld);
  const shoutTask = nextTask(shoutWorld)!;
  const shoutEvent = act(
    shoutWorld,
    shoutTask.agent.id,
    { intent: '召集邻居', action: { type: 'shout', text: '两格以内的朋友，一起采集吧' } },
    shoutTask.id,
  );
  const placeEvent = act(
    shoutWorld,
    shoutTask.agent.id,
    { intent: '', action: { type: 'place', item: 'food', quantity: 1 } },
    'place-fixture',
  );
  fs.writeFileSync(
    'artifacts/shout-fixture.json',
    JSON.stringify({
      format: 'agent-world-v1',
      world: shoutWorld,
      events: [shoutEvent, placeEvent],
      decisions: [],
      snapshots: [{ seq: 0, day: 1, hash: hashWorld(shoutInitial), world: shoutInitial }],
    }),
  );
  const perceptionWorld = createWorld({ population: 2, days: 2 }, 'perception-fixture');
  const [observer, victim] = perceptionWorld.agents;
  observer.x = victim.x = 5;
  observer.y = victim.y = 5;
  victim.hp = 20;
  const perceptionInitial = structuredClone(perceptionWorld);
  const deathEvent = act(
    perceptionWorld,
    observer.id,
    { intent: '', action: { type: 'attack', targetId: victim.id } },
    'corpse-fixture',
  );
  const surveyEvent = act(
    perceptionWorld,
    observer.id,
    { intent: '', action: { type: 'survey' } },
    'survey-fixture',
  );
  fs.writeFileSync(
    'artifacts/perception-fixture.json',
    JSON.stringify({
      format: 'agent-world-v1',
      world: perceptionWorld,
      events: [deathEvent, surveyEvent],
      decisions: [],
      snapshots: [{ seq: 0, day: 1, hash: hashWorld(perceptionInitial), world: perceptionInitial }],
    }),
  );
  const freeWorld = createWorld({ population: 2, days: 1, size: 20 }, 'free-drop-fixture');
  freeWorld.agents[0].x = 1;
  freeWorld.agents[0].y = 1;
  freeWorld.agents[1].x = 18;
  freeWorld.agents[1].y = 18;
  fs.writeFileSync(
    'artifacts/free-drop-fixture.json',
    JSON.stringify({
      format: 'agent-world-v1',
      world: freeWorld,
      events: [],
      decisions: [],
      snapshots: [{ seq: 0, day: 1, hash: hashWorld(freeWorld), world: freeWorld }],
    }),
  );
}
