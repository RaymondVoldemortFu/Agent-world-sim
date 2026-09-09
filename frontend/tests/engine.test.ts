import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld, tileAt, count, living } from '../src/sim/world';
import { act, endDay, nextTask, observe, applyEvent, reflect } from '../src/sim/engine';
import { ActionSchema, type World, type Action, type WorldEvent } from '../src/sim/types';
const make = () => createWorld({ size: 16, population: 3, days: 100, seed: 41 }, 'test');
function doAction(w: World, id: number, action: Action) {
  const a = w.agents.find((a) => a.id === id)!;
  a.ap = Math.max(1, a.ap);
  return act(w, id, { intent: '测试', action }, `test-${w.seq + 1}`);
}
describe('physical world', () => {
  it('reproduces seeded terrain, population and personality', () =>
    expect(hashWorld(make())).toBe(hashWorld(make())));
  it('rejects over-capacity transfers atomically', () => {
    const w = make(),
      a = w.agents[0];
    a.inventory = { food: 11 };
    const t = tileAt(w, a.x, a.y);
    t.ground = { wood: 2 };
    const before = JSON.stringify([a.inventory, t.ground]);
    expect(doAction(w, a.id, { type: 'take', item: 'wood', quantity: 2 }).success).toBe(false);
    expect(JSON.stringify([a.inventory, t.ground])).toBe(before);
    expect(a.ap).toBe(2);
  });
  it('does not enforce social land claims', () => {
    const w = make(),
      a = w.agents[0];
    const t = tileAt(w, a.x, a.y);
    t.farm = 3;
    t.farmFood = 5;
    t.ground = { food: 2 };
    expect(doAction(w, a.id, { type: 'harvest' }).success).toBe(true);
    expect(t.farmFood).toBe(1);
    expect(doAction(w, a.id, { type: 'take', item: 'food', quantity: 2 }).success).toBe(true);
    expect(count(a.inventory, 'food')).toBe(9);
  });
  it('attacks drop all inventory once and dead agents never act', () => {
    const w = make(),
      [a, b] = w.agents;
    b.x = a.x;
    b.y = a.y;
    b.hp = 20;
    b.inventory = { food: 4, wood: 2 };
    expect(doAction(w, a.id, { type: 'attack', targetId: b.id }).success).toBe(true);
    expect(b.death?.cause).toBe('攻击');
    expect(tileAt(w, a.x, a.y).ground).toEqual({ food: 4, wood: 2 });
    expect(doAction(w, a.id, { type: 'attack', targetId: b.id }).success).toBe(false);
    expect(w.counters.deaths).toBe(1);
    expect(() => doAction(w, b.id, { type: 'wait' })).toThrow();
  });
  it('starves without automatic eating', () => {
    const w = make(),
      a = w.agents[0];
    a.hunger = 0;
    a.hp = 20;
    endDay(w);
    expect(a.death?.cause).toBe('饥饿');
    expect(tileAt(w, a.x, a.y).ground.food).toBeGreaterThanOrEqual(3);
  });
  it('recovers food only after two untouched days', () => {
    const w = make(),
      a = w.agents[0],
      t = tileAt(w, a.x, a.y);
    t.terrain = 'plain';
    t.resources.food = 6;
    doAction(w, a.id, { type: 'gather', resource: 'food' });
    expect(t.resources.food).toBe(4);
    endDay(w);
    expect(t.resources.food).toBe(4);
    endDay(w);
    expect(t.resources.food).toBe(4);
    endDay(w);
    expect(t.resources.food).toBe(5);
  });
  it('shares farming labor and shelter construction', () => {
    const w = make(),
      [a, b] = w.agents;
    b.x = a.x;
    b.y = a.y;
    const t = tileAt(w, a.x, a.y);
    t.terrain = 'plain';
    a.inventory = { basic_tool: 1 };
    b.inventory = { basic_tool: 1 };
    doAction(w, a.id, { type: 'terraform' });
    doAction(w, b.id, { type: 'terraform' });
    doAction(w, a.id, { type: 'terraform' });
    expect(t.farm).toBe(3);
    expect(t.farmFood).toBe(0);
    endDay(w);
    expect(t.farmFood).toBe(3);
    a.recipes = ['shelter'];
    b.recipes = ['shelter'];
    a.inventory = { wood: 6 };
    b.inventory = { stone: 2 };
    doAction(w, a.id, { type: 'build', recipeId: 'shelter', materials: { wood: 6 } });
    doAction(w, b.id, { type: 'build', recipeId: 'shelter', materials: { stone: 2 } });
    for (let i = 0; i < 4; i++)
      doAction(w, i % 2 ? a.id : b.id, { type: 'build', recipeId: 'shelter' });
    expect(t.shelter?.complete).toBe(true);
    expect(a.inventory).toEqual({});
    expect(b.inventory).toEqual({});
  });
});
describe('knowledge and perception', () => {
  it('withholds distant events, private inventory, memories and hidden recipes', () => {
    const w = make(),
      [a, b, c] = w.agents;
    a.x = 3;
    a.y = 3;
    b.x = 4;
    b.y = 3;
    c.x = 12;
    c.y = 12;
    b.inventory = { ore: 7 };
    b.intent = 'SECRET_TARGET';
    b.memories = [
      {
        id: 'secret',
        day: 1,
        content: 'SECRET_MEMORY',
        source: 'observed',
        eventIds: [],
        importance: 9,
      },
    ];
    doAction(w, a.id, { type: 'chat', text: '附近可以听见', targetId: b.id });
    expect(b.inbox.at(-1)?.source).toBe('heard');
    expect(c.inbox).toHaveLength(0);
    const o = JSON.stringify(observe(w, a));
    expect(o).not.toContain('SECRET');
    expect(o).not.toContain('"ore":7');
    expect(o).not.toContain('advanced_tool');
    c.x = 3;
    c.y = 3;
    expect(c.inbox).toHaveLength(0);
  });
  it('allows discovery and taught knowledge only after validation', () => {
    const w = make(),
      [a, b] = w.agents;
    b.x = a.x;
    b.y = a.y;
    a.inventory = { wood: 4 };
    b.inventory = { wood: 2 };
    expect(doAction(w, a.id, { type: 'craft', recipeId: 'basic_tool' }).success).toBe(false);
    expect(
      doAction(w, a.id, { type: 'experiment', materials: { wood: 2 }, method: 'combine' }).success,
    ).toBe(true);
    expect(a.recipes).toContain('basic_tool');
    doAction(w, a.id, { type: 'chat', targetId: b.id, text: '两份木材组合可以制作基础工具。' });
    expect(b.recipes).toEqual([]);
    doAction(w, b.id, { type: 'experiment', materials: { wood: 2 }, method: 'combine' });
    expect(b.recipes).toContain('basic_tool');
    expect(b.inventory.basic_tool).toBe(1);
  });
  it('failed experiments retain materials and invented claims do not cite inaccessible events', () => {
    const w = make(),
      a = w.agents[0];
    a.inventory = { wood: 1 };
    doAction(w, a.id, { type: 'experiment', materials: { wood: 1 }, method: 'combine' });
    expect(a.inventory.wood).toBe(1);
    reflect(
      w,
      a.id,
      {
        summary: '我仍未找到配方。',
        claims: [{ content: '未知远方事实', sourceEventIds: [9999] }],
      },
      'reflection',
    );
    expect(a.claims).toHaveLength(0);
  });
});
describe('reproduction', () => {
  function pair() {
    const w = make(),
      [a, b] = w.agents;
    a.sex = 'F';
    b.sex = 'M';
    b.x = a.x;
    b.y = a.y;
    a.hunger = b.hunger = 100;
    return { w, a, b };
  }
  function agree(w: World, a: number, b: number) {
    doAction(w, a, {
      type: 'chat',
      targetId: b,
      text: '共同养育孩子吗？',
      proposal: { kind: 'reproduce', targetId: b },
    });
    const id = w.proposals.at(-1)!.id;
    doAction(w, b, { type: 'chat', targetId: a, text: '我愿意。', acceptProposalId: id });
    return id;
  }
  it('requires both explicit actions and creates a private independent child', () => {
    const { w, a, b } = pair();
    const p = agree(w, a.id, b.id);
    doAction(w, a.id, { type: 'reproduce', proposalId: p });
    expect(a.pregnancy).toBeUndefined();
    doAction(w, b.id, { type: 'reproduce', proposalId: p });
    expect(a.pregnancy?.father).toBe(b.id);
    expect(a.hunger).toBe(80);
    expect(b.hunger).toBe(80);
    a.recipes = ['basic_tool'];
    for (let i = 0; i < 6; i++) {
      a.hunger = b.hunger = 100;
      endDay(w);
    }
    const child = w.agents.at(-1)!;
    expect(child.id).toBe(4);
    expect(child.parents).toEqual([a.id, b.id]);
    expect(child.recipes).toEqual([]);
    expect(child.age).toBe(0);
    expect(child.hunger).toBe(60);
    expect(child.ap).toBe(1);
    expect(w.counters.births).toBe(1);
    expect(a.pregnancy).toBeUndefined();
  });
  it('rejects no agreement, expired attempts, children and wrong locations', () => {
    const { w, a, b } = pair();
    expect(doAction(w, a.id, { type: 'reproduce', proposalId: 'fake' }).success).toBe(false);
    const p = agree(w, a.id, b.id);
    doAction(w, a.id, { type: 'reproduce', proposalId: p });
    endDay(w);
    a.hunger = b.hunger = 100;
    doAction(w, b.id, { type: 'reproduce', proposalId: p });
    expect(a.pregnancy).toBeUndefined();
    b.x += 2;
    expect(doAction(w, a.id, { type: 'reproduce', proposalId: p }).success).toBe(false);
    b.x = a.x;
    b.age = 0;
    expect(doAction(w, b.id, { type: 'reproduce', proposalId: p }).success).toBe(false);
    w.tick = 5;
    expect(doAction(w, a.id, { type: 'reproduce', proposalId: p }).success).toBe(false);
  });
});
describe('scheduler and history', () => {
  it('uses each ID once per micro-round and records deterministic replay', () => {
    const w = make();
    w.config.days = 5;
    const replay = structuredClone(w);
    const ids: number[] = [];
    const events: WorldEvent[] = [];
    while (w.cursor.phase !== 'complete') {
      const task = nextTask(w);
      let e: WorldEvent;
      if (task) {
        ids.push(task.agent.id);
        e =
          task.kind === 'action'
            ? act(w, task.agent.id, { intent: '等待', action: { type: 'wait' } }, task.id)
            : reflect(w, task.agent.id, { summary: '当天经历', claims: [] }, task.id);
      } else e = endDay(w);
      events.push(e);
      applyEvent(replay, e);
      expect(hashWorld(replay)).toBe(hashWorld(w));
    }
    expect(ids.slice(0, 9)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(w.metrics).toHaveLength(5);
    expect(() => applyEvent(replay, events.at(-1)!)).toThrow();
  });
  it('rejects negative item quantities and arbitrary fields', () => {
    expect(ActionSchema.safeParse({ type: 'take', item: 'food', quantity: -1 }).success).toBe(
      false,
    );
    expect(ActionSchema.safeParse({ type: 'wait', damage: 100 }).success).toBe(false);
  });
});
