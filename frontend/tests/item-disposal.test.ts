import { it, expect } from 'vitest';
import { createWorld, tileAt, hashWorld } from '../src/sim/world';
import { act, applyEvent } from '../src/sim/engine';

it('drop destroys dated inventory without putting anything on the ground and is free', () => {
  const w = createWorld({ population: 1 });
  const a = w.agents[0],
    t = tileAt(w, a.x, a.y);
  a.inventory = { food: 3 };
  a.foodBatches = [
    { quantity: 2, expiresOnDay: 1 },
    { quantity: 1, expiresOnDay: 4 },
  ];
  t.ground = { food: 1 };
  t.groundFoodBatches = [{ quantity: 1, expiresOnDay: 2 }];
  const ground = structuredClone([t.ground, t.groundFoodBatches]);
  const replay = structuredClone(w);
  const e = act(
    w,
    a.id,
    { intent: '', action: { type: 'drop', item: 'food', quantity: 2 } },
    'delete',
  );
  expect(e.success).toBe(true);
  expect(a.ap).toBe(5);
  expect(a.inventory).toEqual({ food: 1 });
  expect(a.foodBatches).toEqual([{ quantity: 1, expiresOnDay: 4 }]);
  expect([t.ground, t.groundFoodBatches]).toEqual(ground);
  expect(e.text).toContain('丢弃并销毁');
  applyEvent(replay, e);
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('place costs one AP and preserves food for another person to pick up', () => {
  const w = createWorld({ population: 2, foodShelfLifeDays: 3 });
  const [a, b] = w.agents;
  b.x = a.x;
  b.y = a.y;
  a.age = 0;
  const t = tileAt(w, a.x, a.y),
    replay = structuredClone(w);
  const placed = act(
    w,
    a.id,
    { intent: '', action: { type: 'place', item: 'food', quantity: 2 } },
    'place',
  );
  expect(placed.success).toBe(true);
  expect(a.ap).toBe(4);
  expect(t.ground.food).toBe(2);
  expect(t.groundFoodBatches).toEqual([{ quantity: 2, expiresOnDay: 4 }]);
  applyEvent(replay, placed);
  const taken = act(
    w,
    b.id,
    { intent: '', action: { type: 'take', item: 'food', quantity: 2 } },
    'take',
  );
  expect(taken.success).toBe(true);
  expect(b.inventory.food).toBe(5);
  expect(b.foodBatches).toEqual([{ quantity: 5, expiresOnDay: 4 }]);
  expect(t.ground.food ?? 0).toBe(0);
  applyEvent(replay, taken);
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('neither disposing nor placing can exceed the held stock', () => {
  for (const type of ['drop', 'place'] as const) {
    const w = createWorld({ population: 1 });
    const a = w.agents[0],
      t = tileAt(w, a.x, a.y);
    const before = structuredClone([a.inventory, a.foodBatches, t.ground, t.groundFoodBatches]);
    expect(
      act(w, a.id, { intent: '', action: { type, item: 'food', quantity: 4 } }, type).success,
    ).toBe(false);
    expect([a.inventory, a.foodBatches, t.ground, t.groundFoodBatches]).toEqual(before);
    expect(a.ap).toBe(4);
  }
});
