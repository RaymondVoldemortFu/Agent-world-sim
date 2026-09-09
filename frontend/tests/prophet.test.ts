import { it, expect } from 'vitest';
import { createWorld, hashWorld, makeAgent, tileAt } from '../src/sim/world';
import { act, applyEvent, observe } from '../src/sim/engine';
import { RECIPES } from '../src/sim/recipes';

it('seeds exactly one initial prophet with the complete recipe catalog on a 15x15 map', () => {
  const w = createWorld();
  expect(w.tiles).toHaveLength(225);
  expect(w.agents).toHaveLength(20);
  const prophets = w.agents.filter((a) => a.role === 'prophet');
  expect(prophets).toHaveLength(1);
  expect(prophets[0].recipes).toEqual(RECIPES.map((r) => r.id));
  expect(observe(w, prophets[0]).knownRecipes).toEqual(RECIPES);
  expect(w.agents.filter((a) => !a.role).every((a) => a.recipes.length === 0)).toBe(true);
  expect(prophets[0].inventory).toEqual({ food: 3 });
  expect(prophets[0].ap).toBe(5);
  expect(w.counters.discoveries).toBe(0);
});

it('the prophet can craft both tools and build a shelter but still needs materials', () => {
  const w = createWorld({ population: 1 });
  const a = w.agents[0];
  expect(
    act(w, a.id, { intent: '', action: { type: 'craft', recipeId: 'basic_tool' } }, 'missing')
      .success,
  ).toBe(false);
  a.inventory = { wood: 2 };
  a.foodBatches = [];
  expect(
    act(w, a.id, { intent: '', action: { type: 'craft', recipeId: 'basic_tool' } }, 'basic')
      .success,
  ).toBe(true);
  expect(a.inventory).toEqual({ basic_tool: 1 });
  a.inventory = { basic_tool: 1, wood: 2, stone: 2 };
  expect(
    act(w, a.id, { intent: '', action: { type: 'craft', recipeId: 'advanced_tool' } }, 'advanced')
      .success,
  ).toBe(true);
  expect(a.inventory.advanced_tool).toBe(1);
  a.inventory = { wood: 6, stone: 2 };
  a.ap = 5;
  expect(
    act(
      w,
      a.id,
      {
        intent: '',
        action: { type: 'build', recipeId: 'shelter', materials: { wood: 6, stone: 2 } },
      },
      'materials',
    ).success,
  ).toBe(true);
  for (let i = 0; i < 4; i++)
    expect(
      act(w, a.id, { intent: '', action: { type: 'build', recipeId: 'shelter' } }, `labor-${i}`)
        .success,
    ).toBe(true);
  expect(tileAt(w, a.x, a.y).shelter?.complete).toBe(true);
  expect(a.ap).toBe(0);
});

it('a neighbor learns the method through speech and validates it through experiment', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  b.x = a.x;
  b.y = a.y;
  b.inventory = { wood: 2 };
  b.foodBatches = [];
  const replay = structuredClone(w);
  const spoken = act(
    w,
    a.id,
    {
      intent: '传授制作工具的方法',
      action: { type: 'chat', targetId: b.id, text: '将2份木头用combine组合，能制成基础工具。' },
    },
    'teach',
  );
  applyEvent(replay, spoken);
  expect(b.inbox.at(-1)?.speakerId).toBe(a.id);
  expect(b.recipes).toEqual([]);
  expect(observe(w, b).knownRecipes).toEqual([]);
  const tested = act(
    w,
    b.id,
    {
      intent: '尝试先知的方法',
      action: { type: 'experiment', materials: { wood: 2 }, method: 'combine' },
    },
    'learn',
  );
  expect(tested.success).toBe(true);
  expect(b.recipes).toEqual(['basic_tool']);
  applyEvent(replay, tested);
  expect(hashWorld(replay)).toBe(hashWorld(w));
  const child = makeAgent(w, a.x, a.y, [a.id, b.id]);
  expect(child.role).toBeUndefined();
  expect(child.recipes).toEqual([]);
});

it('only nearby residents see the prophet title; personal recipe knowledge stays private', () => {
  const w = createWorld({ population: 3 });
  const [a, b, c] = w.agents;
  a.x = a.y = 3;
  b.x = 4;
  b.y = 3;
  c.x = c.y = 10;
  expect(observe(w, b).people.find((p) => p.id === a.id)?.role).toBe('prophet');
  expect(observe(w, b).knownRecipes).toEqual([]);
  expect(observe(w, c).people.some((p) => p.id === a.id)).toBe(false);
});
