import { expect, it } from 'vitest';
import { PendingCommit, type CommitPayload } from '../../scripts/continuous/commit';
import { parseModelPlan } from '../../scripts/continuous/plan';
import { createManorWorld } from '../src/continuous/manor/world';
import { ContinuousEngine } from '../src/continuous/engine';
import { DAY, RATION, applyEvent } from '../src/continuous/types';

function candidate(): CommitPayload {
  const w = createManorWorld('recovery-test', 'llm');
  const engine = new ContinuousEngine(w);
  engine.pause(false);
  return { world: w, events: engine.events, expected: 0, snapshot: false };
}
it('confirms a committed request whose HTTP response was lost', async () => {
  const writer = new PendingCommit(),
    p = candidate();
  let durable: unknown;
  const result = await writer.save(p, async (_path, data) => {
    if (data) {
      durable = structuredClone((data as CommitPayload).world);
      throw Error('timeout');
    }
    return durable;
  });
  expect(result).toEqual(p);
  expect(writer.payload).toBeUndefined();
});
it('retains the original transaction across prolonged outage and later caller mutation', async () => {
  const writer = new PendingCommit(),
    p = candidate(),
    original = structuredClone(p);
  await expect(
    writer.save(p, async () => {
      throw Error('offline');
    }),
  ).rejects.toThrow('offline');
  p.world.time += DAY;
  const requests: unknown[] = [];
  const acknowledged = await writer.save(p, async (_path, data) => {
    requests.push(data);
  });
  expect(requests).toEqual([original]);
  expect(acknowledged).toEqual(original);
});
it('does not mistake the same sequence with different state for a durable commit', async () => {
  const writer = new PendingCommit(),
    p = candidate();
  await expect(
    writer.save(p, async (_path, data) => {
      if (data) throw Error('conflict');
      return { ...p.world, time: p.world.time + 1 };
    }),
  ).rejects.toThrow('conflict');
  expect(writer.payload).toEqual(p);
});
it('one-day reserve does not repeatedly preempt rest when already stocked', () => {
  const w = createManorWorld('reserve-test', 'llm'),
    a = w.agents[10];
  for (const other of w.agents) if (other !== a) other.dead = true;
  Object.assign(
    a,
    w.sites.find((s) => s.id === a.home) && {
      x: w.stores.find((s) => s.id === a.home)!.x,
      y: w.stores.find((s) => s.id === a.home)!.y,
    },
  );
  a.grain = 1.2 * RATION;
  a.routine = { eat: true, fetch: true, reserveDays: 1, work: false };
  a.task = { kind: 'rest', target: a.home, amount: 1 };
  const engine = new ContinuousEngine(w);
  engine.pause(false);
  engine.advance(w.time + 10 * 60000);
  expect(engine.events.length).toBeLessThan(10);
  expect(a.action?.kind).toBe('rest');
  // Actual depletion below the target still triggers a withdrawal.
  a.grain = 0.5 * RATION;
  delete a.action;
  engine.advance(w.time + 60 * 60000);
  expect(engine.events.some((e) => e.type === 'withdraw')).toBe(true);
});
it('bounded advance yields replayable boundaries and eventually matches uninterrupted execution', () => {
  const p = candidate(),
    initial = structuredClone(p.world);
  const bounded = new ContinuousEngine(structuredClone(initial));
  const full = new ContinuousEngine(structuredClone(initial));
  full.advance(DAY / 4);
  bounded.advance(DAY / 4, 20);
  expect(bounded.world.time).toBeLessThan(DAY / 4);
  for (let i = 0; i < 200 && bounded.world.time < DAY / 4; i++) bounded.advance(DAY / 4, 20);
  expect(bounded.world).toEqual(full.world);
  const replay = structuredClone(initial);
  for (const e of bounded.events) applyEvent(replay, e);
  replay.time = bounded.world.time;
  expect(replay).toEqual(bounded.world);
});
it('accepts only the known harmless model metadata while validating actions strictly', () => {
  expect(parseModelPlan('{"type":"json_object","intent":"休息"}').intent).toBe('休息');
  expect(() => parseModelPlan('{"type":"attack","intent":"休息"}')).toThrow();
  expect(() => parseModelPlan('{"intent":"休息","routine":{"eat":"yes"}}')).toThrow();
});

it('continues planning beyond archived call and token budgets', () => {
  const w = createManorWorld('unlimited-test', 'llm');
  Object.assign(w, { maxCalls: 1, maxTokens: 1, calls: 15000 });
  const engine = new ContinuousEngine(w);
  expect(engine.thinking(1, 'beyond-budget')).toBeDefined();
  expect(w.calls).toBe(15001);
});

it('normalizes absent optional decisions and harmless scalar representations without changing intent', () => {
  const p = parseModelPlan(
    "```python\n{'type':'json_object','intent':'True 不变','task':None,'routine':{'eat':True,'fetch':'false','reserveDays':'1','work':False},'speech':None,'combat':None}\n```",
  );
  expect(p.intent).toBe('True 不变');
  expect(p.task).toBeNull();
  expect(p.routine).toEqual({ eat: true, fetch: false, reserveDays: 1, work: false });
  expect(p).not.toHaveProperty('speech');
  expect(
    parseModelPlan('{"intent":"发言","speech":{"mode":"talk","text":"你好","text_note":""}}').speech
      ?.text,
  ).toBe('你好');
});
it('rejects incomplete or executable replies and unknown action semantics', () => {
  for (const raw of [
    '{"intent":"截断',
    '{"intent":"等待","task":{"kind":"teleport","target":"hall"}}',
    "{'intent':process.exit()}",
    '{"intent":"等待","routine":{"eat":true,"fetch":true,"reserveDays":-1,"work":true}}',
  ])
    expect(() => parseModelPlan(raw)).toThrow();
});
