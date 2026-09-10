import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/sim/world';
import { observeEco } from '../src/ecology/engine';
import { compactContext, ruleDecision, wantsModel, remember } from '../src/brain/controller';
import { makeRecord, requestDecision, account } from '../src/runtime/model';
import { batch } from '../src/ecology/batches';
const world = () =>
  createWorld(
    { worldModel: 'ecology', population: 2, days: 5, regions: 1, llmDailyCalls: 3 },
    'context-test',
  );
describe('agent context and personality integration', () => {
  it('passes the actual wildlife switch to every actor including old ecology saves', () => {
    const w = world();
    for (const enabled of [true, false]) {
      w.config.wildlifeEnabled = enabled;
      for (const a of w.agents)
        expect(compactContext(observeEco(w, a)).policy.wildlifeEnabled).toBe(enabled);
    }
    delete (w.config as Partial<typeof w.config>).wildlifeEnabled;
    expect(compactContext(observeEco(w, w.agents[1])).policy.wildlifeEnabled).toBe(true);
  });
  it('transmits personality, protected knowledge and observed sequence', () => {
    const w = world(),
      a = w.agents[0];
    a.personality = [0.1, 0.3, 0.5, 0.7, 0.9];
    a.brain!.contextHead = 'a'.repeat(64);
    const c = compactContext(observeEco(w, a));
    expect(c.protocol).toBe('context-1');
    expect(c.self.personality).toEqual([0.1, 0.3, 0.85, 0.7, 0.9]);
    expect(c.contextHead).toBe(a.brain!.contextHead);
    expect(c.seq).toBe(w.seq);
    expect(Object.keys(c.knowledgeLibrary).every((id) => a.eco!.knowledge.includes(id))).toBe(true);
  });
  it('the same food reserve causes different discretionary provisioning decisions', () => {
    const w = world(),
      a = w.agents[0];
    a.eco!.waterL = 6;
    a.eco!.foodKcal = 6000;
    a.eco!.stock = [batch('grain', 0.75, w.tick, 'food', 'test')];
    a.ap = 5;
    a.personality = [0.5, 0, 0.5, 0.5, 0];
    const low = ruleDecision(observeEco(w, a));
    a.personality = [0.5, 1, 0.5, 0.5, 1];
    const high = ruleDecision(observeEco(w, a));
    expect(low.action.type).toBe('wait');
    expect(high.action.type).not.toBe('wait');
  });
  it('extraversion changes social initiation without making consent automatic', () => {
    const w = world(),
      [a, b] = w.agents;
    b.x = a.x;
    b.y = a.y;
    a.ap = 5;
    a.social!.loneliness = 0;
    a.brain!.goal = { skill: 'explore', expires: 5 };
    a.brain!.lastThought = 1;
    a.brain!.lastTalk = 0;
    delete a.role;
    a.personality = [0.5, 0.9, 0, 0.5, 0.5];
    let o = observeEco(w, a);
    expect(wantsModel(o, remember(o))).toBe(false);
    a.personality[2] = 1;
    o = observeEco(w, a);
    expect(wantsModel(o, remember(o))).toBe(true);
    expect(w.proposals).toEqual([]);
  });
  it('commits conversation head and bills compression plus decision once', async () => {
    const w = world(),
      a = w.agents[0];
    a.eco!.waterL = 6;
    a.eco!.foodKcal = 6500;
    a.eco!.stock = [batch('grain', 3, w.tick, 'food', 'test')];
    const r = makeRecord(w);
    expect(r.status).toBe('pending');
    const trace = {
      turnId: 'b'.repeat(64),
      epoch: 1,
      estimatedTokens: 5000,
      reusedMessages: 4,
      recalled: 2,
      compressed: true,
      prefixHash: 'p',
    };
    const result = await requestDecision(
      r,
      async () => {},
      '',
      async () =>
        new Response(
          JSON.stringify({
            id: 'decision',
            status: 200,
            purpose: 'decision',
            content: '{"intent":"维持计划","recall":"阿禾是否归还石斧"}',
            contextTrace: trace,
            usage: { prompt_tokens: 120, completion_tokens: 30, prompt_cache_hit_tokens: 100 },
            auxiliaryAttempts: [
              {
                id: 'compression',
                purpose: 'compression',
                status: 200,
                elapsedMs: 1,
                usage: { prompt_tokens: 500, completion_tokens: 50 },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(result.decision?.brainUpdate?.brain.contextHead).toBe(trace.turnId);
    expect(result.decision?.brainUpdate?.brain.recallQuery).toBe('阿禾是否归还石斧');
    account(w, result);
    expect(w.usage.calls).toBe(2);
    expect(w.usage.inputTokens).toBe(620);
    expect(w.usage.cachedTokens).toBe(100);
    expect(w.usage.contextCompressions).toBe(1);
  });
  it('budget deferral runs fallback without inventing a model call', async () => {
    const w = world(),
      a = w.agents[0];
    a.eco!.waterL = 6;
    a.eco!.foodKcal = 6500;
    a.eco!.stock = [batch('grain', 3, w.tick, 'food', 'test')];
    const r = await requestDecision(
      makeRecord(w),
      async () => {},
      '',
      async () => new Response('{"deferred":true}'),
    );
    expect(r.source).toBe('fallback');
    account(w, r);
    expect(w.usage.calls).toBe(0);
  });
});
