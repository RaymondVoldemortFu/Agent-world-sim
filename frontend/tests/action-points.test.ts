import { it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, nextTask, endDay, applyEvent, observe } from '../src/sim/engine';
import { nextBatch } from '../src/sim/scheduler';
import { makeRecord } from '../src/runtime/model';

it('a free drop leaves five paid actions and records unique replayable decisions', () => {
  const w = createWorld({ population: 1, days: 1 }, 'free-drop');
  const replay = structuredClone(w),
    ids: string[] = [];
  let paid = 0;
  while (w.cursor.phase !== 'complete') {
    const task = nextTask(w);
    let event;
    if (task) {
      const free = ids.length === 0;
      event = act(
        w,
        task.agent.id,
        {
          intent: '',
          action: free ? { type: 'drop', item: 'food', quantity: 1 } : { type: 'wait' },
        },
        task.id,
      );
      ids.push(task.id);
      if (free) {
        expect(task.agent.ap).toBe(5);
        expect(w.cursor.index).toBe(0);
      } else paid++;
    } else event = endDay(w);
    applyEvent(replay, event);
    expect(hashWorld(replay)).toBe(hashWorld(w));
  }
  expect(paid).toBe(5);
  expect(ids).toHaveLength(6);
  expect(new Set(ids).size).toBe(6);
});

it('invalid drops consume AP and advance instead of retrying forever', () => {
  const w = createWorld({ population: 1 });
  const task = nextTask(w)!;
  expect(
    act(
      w,
      task.agent.id,
      { intent: '', action: { type: 'drop', item: 'food', quantity: 4 } },
      task.id,
    ).success,
  ).toBe(false);
  expect(task.agent.ap).toBe(4);
  expect(nextTask(w)!.id).not.toBe(task.id);
  expect(w.cursor.round).toBe(1);
});

it('keeps a prefetched distant reply valid across a free drop and paid action', () => {
  const w = createWorld({ population: 2, size: 20 });
  w.agents[0].x = 1;
  w.agents[0].y = 1;
  w.agents[1].x = 15;
  w.agents[1].y = 15;
  const first = nextBatch(w, 6).map((t) => makeRecord(w, t));
  act(
    w,
    first[0].agentId,
    { intent: '', action: { type: 'drop', item: 'food', quantity: 1 } },
    first[0].id,
  );
  const second = nextBatch(w, 6);
  expect(second[0].id).not.toBe(first[0].id);
  expect(second[1].id).toBe(first[1].id);
  act(w, second[0].agent.id, { intent: '', action: { type: 'wait' } }, second[0].id);
  const next = nextTask(w)!;
  expect(next.id).toBe(first[1].id);
  expect(observe(w, next.agent)).toEqual(first[1].context);
});
