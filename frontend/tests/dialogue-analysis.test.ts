import { describe, expect, it } from 'vitest';
import {
  classify,
  speechEvent,
  filterSpeech,
  summarize,
  SimilarityIndex,
  type Speech,
} from '../src/analysis/dialogue';
import type { WorldEvent } from '../src/sim/types';
const speech = (text: string, seq = 1, recipients = [1, 2, 2]): Speech => ({
  text: `合作 #1 说：“${text}”`,
  seq,
  day: seq,
  type: 'chat',
  actorId: 1,
  decisionId: `d${seq}`,
  recipients,
});
describe('rule-based dialogue analysis', () => {
  it('indexes public speech once and includes every listener in the social graph', () => {
    const event = {
      ...speech('一起分工建粮仓', 1, [1, 2, 3]),
      type: 'public_speak',
      text: '合作 #1 公开说：“一起分工建粮仓”',
      success: true,
    };
    const parsed = speechEvent(event as WorldEvent)!;
    expect(parsed.type).toBe('public_speak');
    const row = classify(parsed);
    expect(row.body).toBe('一起分工建粮仓');
    expect(row.listeners).toEqual([2, 3]);
    const data = summarize([row]);
    expect(data.publicSpeak).toBe(1);
    expect(data.total).toBe(1);
    expect(data.edges).toHaveLength(2);
    expect(filterSpeech([row], { channel: 'public_speak' })).toHaveLength(1);
  });
  it('classifies overlapping intents with evidence, not speaker names or negated agreement', () => {
    const fixtures: [string, string[], string[]][] = [
      ['请帮我找水，哪里有水源？', ['request', 'question'], ['survival']],
      [
        '我们一起分工，你采木我做绳，明天会合。',
        ['cooperate', 'inform'],
        ['industry', 'logistics'],
      ],
      ['我不同意，也不愿意合作。', ['refuse'], []],
      ['谢谢你，朋友，保重。', ['bond'], []],
      ['我教你配方：先磨石片再做工具。', ['teach'], ['industry']],
      ['别抢我的食物，不公平！', ['conflict'], ['survival']],
      ['我们约定粮仓公用，大家平分。', [], ['building', 'norms']],
      ['你愿意繁衍吗？', ['question'], ['reproduction']],
      ['好', ['agree'], []],
    ];
    for (const [text, intents, topics] of fixtures) {
      const r = classify(speech(text));
      for (const i of intents) expect(r.intents, text).toContain(i);
      for (const t of topics) expect(r.topics, text).toContain(t);
    }
    expect(classify(speech('我不同意，也不愿意合作。')).intents).not.toContain('agree');
    expect(classify(speech('我不同意，也不愿意合作。')).intents).not.toContain('cooperate');
    expect(classify(speech('嗯。')).intents).toEqual(['other']);
    expect(classify(speech('不是不愿意，是现在不能去。')).body).toBe('不是不愿意，是现在不能去。');
    expect(classify(speech('谢谢你')).evidence['intent:bond']).toContain('谢谢');
  });
  it('counts utterances once, deduplicates listeners and never infers directed targets from text', () => {
    const a = classify(speech('给3号送木头', 1));
    const b = classify(speech('独自说话', 2, [1]));
    const s = summarize([a, b]);
    expect(s.total).toBe(2);
    expect(s.edges).toEqual([{ from: 1, to: 2, count: 1 }]);
    expect(s.unheard).toBe(1);
    expect(filterSpeech([a, b], { heardOnly: true })).toEqual([a]);
    expect(filterSpeech([a, b], { agent: 2 })).toEqual([a]);
    expect(filterSpeech([a, b], { edge: [1, 3] })).toEqual([]);
    expect(filterSpeech([a, b], { start: 2, end: 2 })).toEqual([b]);
    expect(speechEvent({ ...speech('失败'), success: false } as WorldEvent)).toBeUndefined();
    expect(
      speechEvent({ ...speech('开始'), type: 'action_started', success: true } as WorldEvent),
    ).toBeUndefined();
  });
  it('uses fitted TF-IDF cosine for similar wording with deterministic limits and exclusions', () => {
    const rows = [
      classify(speech('一起搬运木头制作工具', 1)),
      classify(speech('一起搬运木头制作工具', 2)),
      classify(speech('我搬运木头，大家制作工具', 3)),
      classify(speech('你好，今天天气晴朗', 4)),
    ];
    const index = new SimilarityIndex(rows);
    const found = index.similar(1, new Set([1, 2, 3, 4]));
    expect(found[0].row.seq).toBe(2);
    expect(found[0].score).toBeCloseTo(1);
    expect(found.some((r) => r.row.seq === 1)).toBe(false);
    expect(index.similar(1, new Set([4]))).toEqual([]);
    expect(new SimilarityIndex([]).similar(1, new Set())).toEqual([]);
  });
});

describe('village / manor language categories', () => {
  it('separates reserves from field labor, and gives specific evidence priority', () => {
    const fixtures: [string, string, string[]][] = [
      ['今天核对账目，公仓入库20kg，实收与收据一致。', 'accounting', ['reserves', 'records']],
      ['如果秋收后上缴税粮，能否减税或缓缴？', 'negotiate', ['taxes']],
      ['王室税必须立即上缴，不得拖欠。', 'direct', ['taxes', 'authority']],
      ['小心，随身口粮耗尽会饿死，先补粮！', 'warning', ['survival', 'reserves']],
    ];
    for (const [text, primary, topics] of fixtures) {
      const row = classify(speech(text));
      expect(row.primary, text).toBe(primary);
      expect(row.topics, text).toEqual(expect.arrayContaining(topics));
      expect(row.evidence[`intent:${primary}`]?.length).toBeGreaterThan(0);
    }
    expect(classify(speech('家里粮箱存有谷物和粮食')).topics).not.toContain('farming');
    expect(classify(speech('在田里耕作，收获后入库')).topics).toContain('farming');
    expect(classify(speech('我没有收到，也不同意交易。')).intents).not.toContain('agree');
    const protest = classify(speech('我不交税，也不愿合作。'));
    expect(protest.topics).toContain('taxes');
    expect(protest.intents).not.toContain('cooperate');
    expect(classify(speech('卫兵用钥匙开门，邻居在家庭账簿上登记自动任务')).topics).toEqual(
      expect.arrayContaining(['security', 'family', 'records', 'routine']),
    );
  });
});
