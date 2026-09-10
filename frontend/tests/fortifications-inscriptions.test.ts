import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { Tx } from '../src/sim/transaction';
import { ecoAt } from '../src/ecology/world';
import { batch, take, put } from '../src/ecology/batches';
import { BUILDINGS, catalogErrors } from '../src/ecology/catalog';
import { strikeWall, strongestWall } from '../src/ecology/fortifications';
import { fightBeast } from '../src/ecology/wildlife';
import { visibleInscriptions, readInscriptions } from '../src/ecology/inscriptions';
import { observeEco } from '../src/ecology/engine';
import { compactContext, interpret } from '../src/brain/controller';
const world = () => {
  const w = createWorld(
    { worldModel: 'ecology', population: 3, regions: 1, days: 5, wildlifeEnabled: false },
    'wall-test',
  );
  w.agents.forEach((a) => {
    a.x = 5;
    a.y = 5;
    a.brain!.combatPolicy = { mode: 'fight' };
  });
  return w;
};
const wall = (kind: string, condition = 1) => ({
  id: kind,
  kind,
  condition,
  progress: BUILDINGS[kind].minutes,
  contents: [],
});
describe('fortifications and durable writing', () => {
  it('selects only the strongest finished wall, absorbs damage, and leaks damage after breach', () => {
    const w = world(),
      t = ecoAt(w, 5, 5).eco!;
    t.structures = [wall('palisade'), wall('stone_wall')];
    const tx = new Tx(w);
    expect(strongestWall(w, 0, 5, 5)?.kind).toBe('stone_wall');
    expect(strikeWall(w, tx, 0, 5, 5, 100).remaining).toBe(0);
    expect(t.structures[0].condition).toBe(1);
    expect(t.structures[1].condition).toBeCloseTo(750 / 850);
    const hit = strikeWall(w, tx, 0, 5, 5, 800);
    expect(hit.remaining).toBeCloseTo(50);
    expect(hit.message).toContain('攻破');
    t.structures[0].progress = 0;
    expect(strongestWall(w, 0, 5, 5)).toBeUndefined();
    expect(catalogErrors()).toEqual([]);
  });
  it('walls protect only occupants of their tile and can be repaired with actual materials', () => {
    const w = world(),
      t = ecoAt(w, 5, 5).eco!;
    t.structures = [wall('palisade')];
    fightBeast(w, new Tx(w), {
      id: 'b',
      species: 'bear',
      region: 0,
      x: 5,
      y: 5,
      hp: 180,
      maxHp: 180,
      attack: 24,
      born: 0,
      mode: 'raiding',
    });
    expect(w.agents.every((a) => a.hp === 100)).toBe(true);
    expect(t.structures[0].condition).toBeLessThan(1);
    const before = t.structures[0].condition;
    for (const [id, n] of Object.entries(BUILDINGS.palisade.inputs))
      t.ground.push(batch(id, n, 1, id, 'test'));
    act(w, 1, { intent: '修墙', action: { type: 'eco', op: 'repair', id: 'palisade' } }, 'repair');
    endDay(w);
    expect(t.structures[0].condition).toBeGreaterThan(before);
    expect(strikeWall(w, new Tx(w), 0, 6, 5, 24).remaining).toBe(24);
  });
  it('engraves actual material, informs colocated readers once and preserves authorship across transport and replay', () => {
    const w = world(),
      a = w.agents[0],
      t = ecoAt(w, 5, 5).eco!;
    a.eco!.stock = [
      batch('wood_tablet', 1, 1, 'board', 'test'),
      batch('flake', 0.35, 1, 'tool', 'test'),
    ];
    w.agents[2].x = 7;
    const d = interpret(observeEco(w, a), {
      intent: '记录商议',
      goal: {
        skill: 'inscribe',
        item: 'wood_tablet',
        text: '大家约定轮流守夜，仍需各自确认。',
        expires: 3,
      },
    });
    expect(d.action).toMatchObject({ type: 'eco', op: 'inscribe' });
    const replay = structuredClone(w);
    const start = act(w, 1, d, 'carve');
    expect(a.ap).toBeCloseTo(4.5);
    const finish = endDay(w);
    expect(finish.type).toBe('inscribe');
    const board = t.ground.find((b) => b.inscription)!;
    expect(board.inscription).toMatchObject({
      authorId: 1,
      day: 1,
      text: '大家约定轮流守夜，仍需各自确认。',
    });
    expect(w.agents[1].memories.some((m) => m.content.includes('轮流守夜'))).toBe(true);
    expect(w.agents[2].memories.some((m) => m.content.includes('轮流守夜'))).toBe(false);
    expect(a.brain!.goal).toBeUndefined();
    expect(w.proposals).toEqual([]);
    applyEvent(replay, start);
    applyEvent(replay, finish);
    expect(hashWorld(replay)).toBe(hashWorld(w));
    const count = w.agents[1].memories.length;
    readInscriptions(w, new Tx(w), w.agents[1]);
    expect(w.agents[1].memories.length).toBe(count);
    put(a.eco!.stock, take(t.ground, 'inscribed_wood', 1));
    a.x = 7;
    put(ecoAt(w, 7, 5).eco!.ground, take(a.eco!.stock, 'inscribed_wood', 1));
    readInscriptions(w, new Tx(w), w.agents[2]);
    expect(w.agents[2].memories.some((m) => m.content.includes('轮流守夜'))).toBe(true);
    expect(visibleInscriptions(w, w.agents[2])[0].authorId).toBe(1);
    expect(compactContext(observeEco(w, w.agents[2])).inscriptions[0].text).toContain('轮流守夜');
  });
  it('requires stone, cutting and hammer tools before carving stone; failure does not consume the blank', () => {
    const w = world(),
      a = w.agents[0];
    a.eco!.stock = [
      batch('stone_tablet', 2, 1, 'stone', 'test'),
      batch('flake', 0.35, 1, 'tool', 'test'),
    ];
    act(
      w,
      1,
      {
        intent: '刻石',
        action: { type: 'eco', op: 'inscribe', item: 'stone_tablet', text: '粮仓约定' },
      },
      'stone-fail',
    );
    expect(endDay(w).success).toBe(false);
    expect(a.eco!.stock[0].kg).toBe(2);
    a.eco!.stock.push(batch('handaxe', 0.8, 1, 'hammer', 'test'));
    act(
      w,
      1,
      {
        intent: '刻石',
        action: { type: 'eco', op: 'inscribe', item: 'stone_tablet', text: '粮仓约定' },
      },
      'stone-ok',
    );
    expect(endDay(w).success).toBe(true);
    expect(visibleInscriptions(w, a)[0].text).toBe('粮仓约定');
  });
});
