import { it, expect } from 'vitest';
import { createWorld, hashWorld, makeAgent, tileAt } from '../src/sim/world';
import { act, applyEvent, endDay, observe } from '../src/sim/engine';
import { lonelinessCapacity } from '../src/sim/social';

it('personality determines capacity and loneliness starts at the second silent day end', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.personality[2] = 1;
  b.personality[2] = 0;
  expect(lonelinessCapacity(a)).toBe(40);
  expect(lonelinessCapacity(b)).toBe(100);
  endDay(w);
  expect(a.social?.loneliness).toBe(0);
  endDay(w);
  expect(a.social?.loneliness).toBe(20);
  endDay(w);
  expect(a.social).toMatchObject({ loneliness: 40, depressed: true });
  expect(b.social).toMatchObject({ loneliness: 40, depressed: false });
  expect(a.hp).toBe(90);
  expect(b.hp).toBe(100);
});

it('depression remains below capacity and only clears when successful speech empties loneliness', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.x = b.x = 3;
  a.y = b.y = 3;
  a.personality[2] = 1;
  a.social = { loneliness: 40, lastSpokeDay: 0, depressed: true };
  const replay = structuredClone(w);
  const say = () => {
    const e = act(
      w,
      a.id,
      { intent: '', action: { type: 'chat', text: '一起聊聊' } },
      `s-${w.seq}`,
    );
    applyEvent(replay, e);
    expect(hashWorld(replay)).toBe(hashWorld(w));
  };
  say();
  expect(a.social).toEqual({ loneliness: 20, lastSpokeDay: 1, depressed: true });
  expect(b.social?.lastSpokeDay).toBe(0);
  applyEvent(replay, endDay(w));
  expect(a.hp).toBe(90);
  expect(a.social.depressed).toBe(true);
  expect(hashWorld(replay)).toBe(hashWorld(w));
  say();
  expect(a.social).toEqual({ loneliness: 0, lastSpokeDay: 2, depressed: false });
  applyEvent(replay, endDay(w));
  expect(a.hp).toBe(95);
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('only actual speech to a living listener helps, including two-cell shouts', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.x = a.y = 3;
  b.x = b.y = 5;
  a.social!.loneliness = 30;
  act(w, a.id, { intent: '', action: { type: 'chat', text: '没人听到' } }, 'alone');
  expect(a.social).toMatchObject({ loneliness: 30, lastSpokeDay: 0 });
  act(
    w,
    a.id,
    { intent: '', action: { type: 'chat', text: '距离太远', targetId: b.id } },
    'failed',
  );
  expect(a.social?.loneliness).toBe(30);
  act(w, a.id, { intent: '', action: { type: 'shout', text: '听得到吗' } }, 'heard');
  expect(a.social).toMatchObject({ loneliness: 10, lastSpokeDay: 1 });
  expect(b.social?.loneliness).toBe(0);
  expect(b.social?.lastSpokeDay).toBe(0);
  b.death = { day: 1, cause: '测试' };
  b.hp = 0;
  a.ap = 2;
  act(w, a.id, { intent: '', action: { type: 'shout', text: '还有人吗' } }, 'dead-listener');
  expect(a.social?.loneliness).toBe(10);
});

it('speech resets the silent-day clock even if loneliness is already zero', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.x = b.x = 3;
  a.y = b.y = 3;
  endDay(w);
  act(w, a.id, { intent: '', action: { type: 'chat', text: '你好' } }, 'hello');
  endDay(w);
  expect(a.social?.loneliness).toBe(0);
  endDay(w);
  expect(a.social?.loneliness).toBe(0);
  endDay(w);
  expect(a.social?.loneliness).toBe(20);
});

it('depression death drops inventory and replays with its actual cause', () => {
  const w = createWorld({ population: 1 });
  const a = w.agents[0];
  a.hp = 10;
  a.hunger = 50;
  a.social = { loneliness: 40, lastSpokeDay: 0, depressed: true };
  const replay = structuredClone(w);
  const e = endDay(w);
  expect(a.death?.cause).toBe('抑郁');
  expect(a.hp).toBe(0);
  expect(a.inventory).toEqual({});
  expect(tileAt(w, a.x, a.y).ground.food).toBe(3);
  expect(e.text).toContain('1 人死亡');
  applyEvent(replay, e);
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('newborns start their own social clock and private state stays private', () => {
  const w = createWorld({ population: 2 });
  w.tick = 10;
  const child = makeAgent(w, 3, 3, [1, 2]);
  expect(child.social).toEqual({ loneliness: 0, lastSpokeDay: 9, depressed: false });
  const [a, b] = w.agents;
  a.x = b.x = 3;
  a.y = b.y = 3;
  const view = observe(w, a);
  expect(view.self.social?.capacity).toBe(lonelinessCapacity(a));
  expect(view.people[0]).not.toHaveProperty('social');
});

it('ground items are not droppable until taken into the personal inventory', () => {
  const w = createWorld({ population: 1 });
  const a = w.agents[0];
  a.inventory = {};
  a.foodBatches = [];
  tileAt(w, a.x, a.y).ground = { wood: 2 };
  const e = act(
    w,
    a.id,
    { intent: '', action: { type: 'drop', item: 'wood', quantity: 1 } },
    'ground',
  );
  expect(e.success).toBe(false);
  expect(tileAt(w, a.x, a.y).ground.wood).toBe(2);
  act(w, a.id, { intent: '', action: { type: 'take', item: 'wood', quantity: 1 } }, 'take');
  expect(
    act(w, a.id, { intent: '', action: { type: 'drop', item: 'wood', quantity: 1 } }, 'drop')
      .success,
  ).toBe(true);
});
