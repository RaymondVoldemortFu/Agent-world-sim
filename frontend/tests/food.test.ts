import { expect, it } from 'vitest';
import { createWorld, tileAt, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent, observe } from '../src/sim/engine';
import { foodSummary, validateFood } from '../src/sim/food';
import type { Action, World } from '../src/sim/types';

function fixture() {
  const w = createWorld({ population: 2, foodShelfLifeDays: 3, inventoryCapacity: 12 }, 'food-test');
  const [a, b] = w.agents;
  b.x = a.x;
  b.y = a.y;
  for (const agent of w.agents) {
    agent.inventory = {};
    agent.foodBatches = [];
  }
  return { w, a, b, tile: tileAt(w, a.x, a.y) };
}
function action(w: World, id: number, value: Action) {
  w.agents.find((a) => a.id === id)!.ap = 3;
  return act(w, id, { intent: '测试', action: value }, `test-${w.seq + 1}`);
}
it('starts with a 15×15 map, four food per plain and dated initial rations', () => {
  const w = createWorld();
  expect(w.tiles).toHaveLength(225);
  expect(w.tiles.filter((t) => t.terrain === 'plain').every((t) => t.resources.food === 4)).toBe(
    true,
  );
  expect(w.config.reproductionSuccessRate).toBe(1);
  for (const a of w.agents) {
    validateFood(a.inventory, a.foodBatches);
    expect(foodSummary(a.foodBatches, 4)).toEqual({ fresh: 3, spoiled: 0 });
    expect(foodSummary(a.foodBatches, 5)).toEqual({ fresh: 0, spoiled: 3 });
  }
});
it('food gathered on day 1 is fresh on day 3 and poisons on day 4', () => {
  const { w, a } = fixture();
  action(w, a.id, { type: 'gather', resource: 'food' });
  w.tick = 3;
  a.hunger = 20;
  expect(action(w, a.id, { type: 'eat', quantity: 1 }).success).toBe(true);
  expect(a.hunger).toBe(40);
  expect(a.hp).toBe(100);
  w.tick = 4;
  const event = action(w, a.id, { type: 'eat', quantity: 1 });
  expect(event.text).toContain('腐败');
  expect(a.hp).toBe(80);
  expect(a.hunger).toBe(60);
  validateFood(a.inventory, a.foodBatches);
});
it('retains expiry through gifts, ground transfers, death drops and feeding', () => {
  const { w, a, b, tile } = fixture();
  action(w, a.id, { type: 'gather', resource: 'food' });
  w.tick = 2;
  action(w, a.id, { type: 'give', targetId: b.id, item: 'food', quantity: 1 });
  w.tick = 3;
  action(w, b.id, { type: 'place', item: 'food', quantity: 1 });
  w.tick = 4;
  action(w, b.id, { type: 'take', item: 'food', quantity: 1 });
  expect(b.foodBatches).toEqual([{ expiresOnDay: 4, quantity: 1 }]);
  a.hp = 20;
  a.hunger = 40;
  const event = action(w, b.id, { type: 'feed', targetId: a.id });
  expect(event.success).toBe(true);
  expect(a.death?.cause).toBe('食物腐败');
  expect(a.hunger).toBe(60);
  expect(tile.groundFoodBatches).toEqual([{ expiresOnDay: 4, quantity: 1 }]);
  validateFood(tile.ground, tile.groundFoodBatches);
  validateFood(a.inventory, a.foodBatches);
  validateFood(b.inventory, b.foodBatches);
});
it('prefers fresh food when eating and charges damage only for spoiled remainder', () => {
  const { w, a } = fixture();
  a.inventory = { food: 3 };
  a.foodBatches = [
    { quantity: 2, expiresOnDay: 4 },
    { quantity: 1, expiresOnDay: 6 },
  ];
  w.tick = 4;
  a.hunger = 20;
  action(w, a.id, { type: 'eat', quantity: 2 });
  expect(a.hp).toBe(80);
  expect(a.hunger).toBe(60);
  expect(a.foodBatches).toEqual([{ quantity: 1, expiresOnDay: 4 }]);
});
it('uses configured spoiled nutrition, clamps hunger and still damages health', () => {
  const { w, a, b } = fixture();
  a.inventory = { food: 2 };
  a.foodBatches = [{ quantity: 2, expiresOnDay: 4 }];
  w.tick = 4;
  w.config.spoiledFoodHungerGain = 30;
  b.hunger = 90;
  action(w, a.id, { type: 'feed', targetId: b.id });
  expect(b.hunger).toBe(100);
  expect(b.hp).toBe(80);
  w.config.spoiledFoodHungerGain = 0;
  a.hunger = 10;
  action(w, a.id, { type: 'eat', quantity: 1 });
  expect(a.hunger).toBe(10);
  expect(a.hp).toBe(80);
});
it('rejects over-capacity food transfers without changing either dated store', () => {
  const { w, a, b } = fixture();
  action(w, a.id, { type: 'gather', resource: 'food' });
  b.inventory = { wood: 12 };
  const before = JSON.stringify([a.inventory, a.foodBatches, b.inventory, b.foodBatches]);
  expect(action(w, a.id, { type: 'give', targetId: b.id, item: 'food', quantity: 1 }).success).toBe(
    false,
  );
  expect(JSON.stringify([a.inventory, a.foodBatches, b.inventory, b.foodBatches])).toBe(before);
});
it('a second gathering resets the plain recovery clock', () => {
  const { w, a, tile } = fixture();
  action(w, a.id, { type: 'gather', resource: 'food' });
  for (let i = 0; i < 3; i++) endDay(w);
  expect(w.tick).toBe(4);
  action(w, a.id, { type: 'gather', resource: 'food' });
  for (let i = 0; i < 4; i++) {
    endDay(w);
    expect(tile.resources.food ?? 0).toBe(0);
  }
  endDay(w);
  expect(w.tick).toBe(9);
  expect(tile.resources.food).toBe(1);
});
it('harvests dated food while farm crops continue growing during plain cooldown', () => {
  const { w, a, tile } = fixture();
  tile.farm = 3;
  tile.farmFood = 4;
  tile.lastGather = 1;
  action(w, a.id, { type: 'harvest' });
  expect(a.foodBatches).toEqual([{ expiresOnDay: 4, quantity: 4 }]);
  endDay(w);
  expect(tile.farmFood).toBe(3);
});
it('replays expiry, poison death and dropped batches exactly', () => {
  const { w, a } = fixture();
  a.hp = 20;
  a.hunger = 100;
  const replay = structuredClone(w);
  const commit = (event: ReturnType<typeof act>) => {
    applyEvent(replay, event);
    expect(hashWorld(replay)).toBe(hashWorld(w));
  };
  commit(act(w, a.id, { intent: '', action: { type: 'gather', resource: 'food' } }, 'gather'));
  for (let i = 0; i < 3; i++) commit(endDay(w));
  const view = observe(w, a);
  expect(view.self.food?.spoiled).toBe(2);
  // Natural recovery raises HP to 30; two spoiled portions are fatal.
  commit(act(w, a.id, { intent: '', action: { type: 'eat', quantity: 2 } }, 'eat'));
  expect(a.death?.cause).toBe('食物腐败');
});
