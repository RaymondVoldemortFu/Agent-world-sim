import { expect, it } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, endDay, applyEvent } from '../src/sim/engine';
import { Tx } from '../src/sim/transaction';
import { MANOR_CONFIG } from '../src/manor/world';
import { executeManor } from '../src/manor/engine';
import { observeEco, minutesFor } from '../src/ecology/engine';
import { visibleInscriptions, writeLedger, showLedger } from '../src/ecology/inscriptions';
import { put, take } from '../src/ecology/batches';
import { compactContext, interpret, ruleDecision } from '../src/brain/controller';
import { worldInscriptions } from '../src/ui/inscriptions-data';
const setup = () => {
  const w = createWorld(MANOR_CONFIG, 'ledger-test');
  const [a, b, c] = w.agents;
  for (const person of [a, b, c]) {
    person.x = 9;
    person.y = 10;
    person.eco!.foodKcal = 5000;
  }
  return { w, a, b, c, id: `ledger-${a.id}` };
};
it('gives lord and reeve one physical ledger each with new experiment defaults', () => {
  const { w, a } = setup();
  expect(w.config).toMatchObject({ contextWindow: 100000, days: 150 });
  expect(w.manor!.settings.shockDay).toBe(40);
  expect(
    w.agents.filter((a) => a.eco!.stock.some((b) => b.item === 'personal_ledger')).map((a) => a.id),
  ).toEqual([w.agents[0].id, w.agents[6].id]);
  expect(a.residence!.biography).toContain('write_ledger');
});
it('writes privately through model goal and execution, completes once, and replays with authorship', () => {
  const { w, a, b, id } = setup();
  const replay = structuredClone(w);
  const d = interpret(observeEco(w, a), {
    intent: '记实际收支',
    goal: {
      skill: 'estate',
      op: 'write_ledger',
      id,
      text: '秘密账目：实收三公斤，五公斤尚未交付。',
      expires: 10,
    },
  });
  expect(d.action).toMatchObject({ type: 'manor', op: 'write_ledger', id });
  expect(minutesFor(w, a, d.action)).toBe(60);
  const events = [act(w, a.id, d, 'write'), endDay(w)];
  expect(a.brain!.goal).toBeUndefined();
  expect(visibleInscriptions(w, a)[0]).toMatchObject({
    authorId: a.id,
    carrierId: id,
    text: '秘密账目：实收三公斤，五公斤尚未交付。',
  });
  expect(JSON.stringify(compactContext(observeEco(w, b)))).not.toContain('秘密账目');
  expect(worldInscriptions(w).filter((r) => r.item === 'personal_ledger')).toHaveLength(1);
  events.forEach((e) => applyEvent(replay, e));
  expect(hashWorld(replay)).toBe(hashWorld(w));
  expect(a.eco!.stock.find((b) => b.id === id)?.pages).toHaveLength(1);
});
it('shows only current entries to the chosen nearby person; later writing stays private', () => {
  const { w, a, b, c, id } = setup();
  writeLedger(w, new Tx(w), a, id, '私账甲');
  b.x = 10;
  a.brain!.goal = { skill: 'estate', op: 'show_ledger', id, targetId: b.id, expires: 10 };
  const d = ruleDecision(observeEco(w, a));
  expect(d.action).toMatchObject({ type: 'manor', op: 'show_ledger', targetId: b.id });
  expect(minutesFor(w, a, d.action)).toBe(24);
  act(w, a.id, d, 'show');
  endDay(w);
  expect(a.brain!.goal).toBeUndefined();
  expect(JSON.stringify(b.memories)).toContain('私账甲');
  expect(JSON.stringify(c.memories)).not.toContain('私账甲');
  writeLedger(w, new Tx(w), a, id, '私账乙');
  expect(JSON.stringify(compactContext(observeEco(w, b)))).not.toContain('私账乙');
  expect(a.eco!.stock.find((x) => x.id === id)?.pages).toHaveLength(2);
  b.x = 20;
  expect(() => showLedger(w, new Tx(w), a, id, b.id)).toThrow('一格');
  b.x = 9;
  b.death = { day: 1, cause: 'test' };
  expect(() => showLedger(w, new Tx(w), a, id, b.id)).toThrow('活着');
});
it('requires physical possession even on ground or in storage; another holder can append and show', () => {
  const { w, a, b, id } = setup();
  writeLedger(w, new Tx(w), a, id, '秘密账本内容');
  expect(() => writeLedger(w, new Tx(w), b, id, '伪造')).toThrow('持有');
  expect(() => take(a.eco!.stock, 'personal_ledger', 0.5)).toThrow('整本');
  const tile = w.tiles[a.y * w.config.size + a.x];
  put(tile.eco!.ground, take(a.eco!.stock, 'personal_ledger', 1));
  expect(visibleInscriptions(w, b).some((r) => r.carrierId === id)).toBe(false);
  expect(JSON.stringify(compactContext(observeEco(w, b)))).not.toContain('秘密账本内容');
  const store = tile.eco!.structures[0];
  put(store.contents, take(tile.eco!.ground, 'personal_ledger', 1));
  expect(JSON.stringify(compactContext(observeEco(w, b)))).not.toContain('秘密账本内容');
  expect(() => showLedger(w, new Tx(w), a, id, b.id)).toThrow('持有');
  executeManor(w, new Tx(w), b, {
    type: 'manor',
    op: 'withdraw',
    id: store.id,
    item: 'personal_ledger',
    amount: 1,
  });
  expect(visibleInscriptions(w, b).some((r) => r.text === '秘密账本内容')).toBe(true);
  writeLedger(w, new Tx(w), b, id, '新持有人追加');
  expect(b.eco!.stock.find((x) => x.id === id)?.pages?.map((r) => r.authorId)).toEqual([
    a.id,
    b.id,
  ]);
});
