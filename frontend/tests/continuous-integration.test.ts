import { expect, it } from 'vitest';
import { ContinuousConfigSchema, continuousConfig } from '../src/continuous/config';
import { createContinuousWorld } from '../src/continuous/world';
import { ContinuousSpeechReader } from '../src/analysis/continuous-dialogue';
import { classify, speechEvent, summarize } from '../src/analysis/dialogue';
import { DAY } from '../src/continuous/types';

it('persists effective continuous settings and reads older archives', () => {
  const config = {
    days: 7,
    concurrency: 2,
    contextWindow: 64000,
    inventoryCapacity: 9,
  };
  const w = createContinuousWorld('settings', 'llm', config.days, config);
  expect(continuousConfig(JSON.parse(JSON.stringify(w)))).toEqual(
    ContinuousConfigSchema.parse({ ...config, scenario: 'elmwick' }),
  );
  expect(w.agents.every((a) => a.capacity === 9 && a.grain <= a.capacity)).toBe(true);
  delete w.settings;
  expect(continuousConfig(w)).toEqual(
    ContinuousConfigSchema.parse({
      ...config,
      scenario: 'elmwick',
      concurrency: 5,
      contextWindow: 100000,
    }),
  );
  expect(ContinuousConfigSchema.safeParse({ contextWindow: 3999 }).success).toBe(false);
  expect(ContinuousConfigSchema.safeParse({ concurrency: 9 }).success).toBe(false);
  expect(ContinuousConfigSchema.safeParse({ days: 1.5 }).success).toBe(false);
});
it('recovers historical channels across pages and counts only completed speech', () => {
  const reader = new ContinuousSpeechReader();
  expect(
    reader.read({ seq: 1, time: 0, type: 'speaking', actor: 1, channel: 'shout', text: '' }),
  ).toBeUndefined();
  expect(
    reader.read({ seq: 2, time: 0, type: 'speaking', actor: 2, channel: 'public_speak', text: '' }),
  ).toBeUndefined();
  const a = reader.read({
    seq: 3,
    time: DAY,
    type: 'speech',
    actor: 1,
    text: '小心断粮',
    listeners: [2, 3],
  })!;
  expect(a.type).toBe('shout');
  expect(a.day).toBe(2);
  expect(a.decisionId).toBe(`continuous:${DAY}:3`);
  const b = reader.read({
    seq: 4,
    time: DAY,
    type: 'speech',
    actor: 2,
    channel: 'talk',
    text: '一起耕作',
    listeners: [1],
  })!;
  expect(b.type).toBe('chat');
  const stats = summarize([a, b].map((e) => classify(speechEvent(e)!)));
  expect(stats.total).toBe(2);
  expect(stats.edges).toHaveLength(3);
  expect(stats.shout).toBe(1);
});

it('ignores retired request and token budgets in archived settings', () => {
  const config = ContinuousConfigSchema.parse({ maxCalls: 1, maxTokens: 1, contextWindow: 64000 });
  expect(config).not.toHaveProperty('maxCalls');
  expect(config).not.toHaveProperty('maxTokens');
  expect(config.contextWindow).toBe(64000);
  const w = createContinuousWorld('old-settings', 'llm', 150);
  Object.assign(w.settings!, { maxCalls: 1, maxTokens: 1 });
  expect(continuousConfig(w)).not.toHaveProperty('maxCalls');
  expect(continuousConfig(w)).not.toHaveProperty('maxTokens');
});
