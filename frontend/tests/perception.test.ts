import { it, expect } from 'vitest';
import { act, endDay, observe, applyEvent, nextTask } from '../src/sim/engine';
import { createWorld, hashWorld, tileAt } from '../src/sim/world';
import { nextBatch } from '../src/sim/scheduler';
import { surveyArea } from '../src/sim/perception';

it.each(['攻击', '食物腐败', '饥饿', '抑郁'])(
  'retains a visible persistent corpse after %s death',
  (cause) => {
    const w = createWorld({ population: 2 });
    const [a, b] = w.agents;
    a.x = b.x = 5;
    a.y = b.y = 5;
    b.hp = 20;
    if (cause === '食物腐败') b.foodBatches = [{ quantity: 3, expiresOnDay: 1 }];
    if (cause === '饥饿') b.hunger = 0;
    if (cause === '抑郁') {
      b.hp = 10;
      b.hunger = 50;
      b.social = { loneliness: 40, lastSpokeDay: 0, depressed: true };
    }
    const replay = structuredClone(w);
    const event =
      cause === '攻击'
        ? act(w, a.id, { intent: '', action: { type: 'attack', targetId: b.id } }, 'kill')
        : cause === '食物腐败'
          ? act(w, b.id, { intent: '', action: { type: 'eat', quantity: 1 } }, 'poison')
          : endDay(w);
    expect(b.death?.cause).toBe(cause);
    expect(b.corpse).toEqual({ x: 5, y: 5, sinceDay: 1 });
    expect(observe(w, a).corpses).toContainEqual({
      id: b.id,
      name: b.name,
      x: 5,
      y: 5,
      status: 'dead',
    });
    expect(observe(w, a).people).toHaveLength(0);
    applyEvent(replay, event);
    expect(hashWorld(replay)).toBe(hashWorld(w));
    for (let i = 0; i < 3; i++) endDay(w);
    expect(b.corpse).toEqual({ x: 5, y: 5, sinceDay: 1 });
    a.ap = 5;
    a.social!.loneliness = 30;
    expect(
      act(
        w,
        a.id,
        { intent: '', action: { type: 'chat', targetId: b.id, text: '你好' } },
        'dead-chat',
      ).success,
    ).toBe(false);
    act(w, a.id, { intent: '', action: { type: 'shout', text: '有人吗' } }, 'dead-shout');
    expect(a.social?.loneliness).toBe(30);
  },
);

it('survey costs 2 AP and records a private, frozen 7x7 view with living people and corpses', () => {
  const w = createWorld({ population: 4 });
  const [a, b, c, d] = w.agents;
  a.x = a.y = 5;
  b.x = b.y = 8;
  b.sex = 'F';
  b.age = 0;
  c.x = 9;
  c.y = 5;
  d.x = 8;
  d.y = 5;
  d.hp = 20;
  d.foodBatches = [{ quantity: 3, expiresOnDay: 1 }];
  act(w, d.id, { intent: '', action: { type: 'eat', quantity: 1 } }, 'die');
  b.inventory = { ore: 7 };
  b.memories = [
    { id: 'private', day: 1, content: 'SECRET', source: 'inferred', eventIds: [], importance: 5 },
  ];
  const replay = structuredClone(w);
  const event = act(w, a.id, { intent: '', action: { type: 'survey' } }, 'survey');
  expect(event.success).toBe(true);
  expect(event.recipients).toEqual([a.id]);
  expect(a.ap).toBe(3);
  expect(a.survey?.tiles).toHaveLength(49);
  expect(a.survey?.people.map((p) => p.id)).toEqual([b.id]);
  expect(a.survey?.people[0]).toMatchObject({ sex: 'F', ageStage: 'child' });
  expect(a.survey?.corpses.map((p) => p.id)).toEqual([d.id]);
  expect(JSON.stringify(a.survey)).not.toContain('SECRET');
  expect(a.survey?.people[0]).not.toHaveProperty('inventory');
  applyEvent(replay, event);
  expect(hashWorld(replay)).toBe(hashWorld(w));
  const snapshot = structuredClone(a.survey);
  b.x = 10;
  tileAt(w, 8, 8).resources = {};
  expect(observe(w, a).lastSurvey).toEqual(snapshot);
  expect(observe(w, a).tiles).toHaveLength(9);
  expect(observe(w, c).lastSurvey).toBeUndefined();
});

it('survey clips at map edges, supports juveniles and fails with only one AP', () => {
  const w = createWorld({ population: 1 });
  const a = w.agents[0];
  a.x = a.y = 0;
  a.age = 0;
  const event = act(w, a.id, { intent: '', action: { type: 'survey' } }, 'edge');
  expect(event.success).toBe(true);
  expect(a.survey?.tiles).toHaveLength(16);
  const saved = structuredClone(a.survey);
  a.ap = 1;
  expect(act(w, a.id, { intent: '', action: { type: 'survey' } }, 'insufficient').success).toBe(
    false,
  );
  expect(a.ap).toBe(0);
  expect(a.survey).toEqual(saved);
});

it('parallel decisions stay valid while survey samples a preceding distant death at commit time', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.x = a.y = 5;
  b.x = 8;
  b.y = 5;
  a.hp = 20;
  a.foodBatches = [{ quantity: 3, expiresOnDay: 1 }];
  const batch = nextBatch(w, 6);
  expect(batch).toHaveLength(2);
  const prefetched = structuredClone(observe(w, b));
  act(w, a.id, { intent: '', action: { type: 'eat', quantity: 1 } }, batch[0].id);
  expect(observe(w, b)).toEqual(prefetched);
  expect(nextTask(w)!.id).toBe(batch[1].id);
  act(w, b.id, { intent: '', action: { type: 'survey' } }, batch[1].id);
  expect(b.survey?.people).toHaveLength(0);
  expect(b.survey?.corpses.map((p) => p.id)).toEqual([a.id]);
});

it('a dense full survey remains inside the proxy context size limit', () => {
  const w = createWorld({ population: 60 });
  const a = w.agents[0];
  w.agents.forEach((b) => {
    b.x = b.y = 5;
  });
  for (const t of w.tiles) {
    t.ground = { food: 12, wood: 12, stone: 12, ore: 12, basic_tool: 6, advanced_tool: 6 };
    t.groundFoodBatches = [{ quantity: 12, expiresOnDay: 4 }];
    t.farm = 3;
    t.farmFood = 12;
    t.shelter = { materials: { wood: 6, stone: 2 }, labor: 4, complete: true };
  }
  a.survey = surveyArea(w, a);
  // Python json.dumps adds a space after commas and colons before applying its guard.
  const serialized = JSON.stringify(observe(w, a)).replace(/[:,]/g, '$& ');
  expect(serialized.length).toBeLessThan(40000);
});
