import type { WorldEvent } from '../sim/types';
export const VERSION = 'dialogue-rules-1';
export const INTENTS = {
  request: '请求 / 求助',
  cooperate: '协作 / 分工',
  offer: '承诺 / 提供',
  teach: '知识传授',
  inform: '状态通报',
  question: '询问',
  agree: '同意 / 确认',
  refuse: '拒绝 / 撤回',
  conflict: '争执 / 威胁',
  bond: '关怀 / 社交',
  other: '未分类',
};
export const TOPICS = {
  survival: '食物 / 饮水',
  industry: '工具 / 加工',
  farming: '农业',
  building: '建筑 / 仓储',
  logistics: '地点 / 搬运',
  health: '健康 / 情绪',
  reproduction: '繁衍',
  norms: '分配 / 规范',
  other: '未分类',
};
export type Intent = keyof typeof INTENTS;
export type Topic = keyof typeof TOPICS;
// Bounded phrases; evidence is shown verbatim. These labels describe linguistic cues.
const intentRules: Record<Exclude<Intent, 'other'>, RegExp[]> = {
  request: [
    /请(?:你|帮|给|来|带|教|把|借)/g,
    /帮(?:我|忙|一下)/g,
    /(?:能不能|能否|可以).{0,8}(?:给|帮|借|教|带)/g,
    /(?:给我|借我|救命|求助|求救|缺粮|缺水)/g,
  ],
  cooperate: [
    /一起|合作|分工|各自|配合|轮流|共同/g,
    /我(?:来|负责).{0,20}你(?:来|负责)/g,
    /你.{0,12}我.{0,12}(?:采|做|搬|挖|收|留|种)/g,
    /(?:换|交换|交易|互助|互换|会合|汇合|碰头)/g,
  ],
  offer: [
    /我(?:来|会|愿意|负责|可以|帮你|给你|带来)/g,
    /(?:我|给你|替你|为你).{0,8}(?:留|送|带|拿|做|准备)/g,
    /(?:答应|保证|承诺|送给|分给)/g,
  ],
  teach: [
    /教你|教大家|教给|方法是|做法是|配方|步骤|需要先|学会/g,
    /(?:先.{0,20}再|用.{0,18}(?:制作|制成|合成|加工))/g,
    /(?:播种|种植|收获).{0,10}(?:季节|窗口|天|春|秋)/g,
  ],
  inform: [
    /我(?:在|到|有|手上|背包|已|现在|目前)/g,
    /(?:这里|那里|地面|脚下).{0,12}(?:有|剩|没有|缺)/g,
    /已经|完成了|做完|到了|还剩|剩余|发现|今天|明天|目前/g,
  ],
  question: [
    /怎么|如何|哪里|在哪|谁能|谁有|多少|什么|为什么|是否|几天|何时/g,
    /[吗么][？?]?|[？?]/g,
  ],
  agree: [
    /收到|同意|答应|接受|没问题|可以的|好的|好啊|愿意|说定|就这么办/g,
    /^(?:好|行|可以)(?:[，,。.!！\s]|$)/g,
  ],
  refuse: [/不(?:同意|接受|愿意|能给|给|借|去|换|行)|拒绝|撤回|取消|别再|不要再|没法|不能答应/g],
  conflict: [/抢走|抢夺|偷走|偷拿|威胁|打你|杀|攻击|滚开|不许|别抢|骗子|欺骗|不公平/g],
  bond: [/谢谢|感谢|你好|朋友|伙伴|辛苦|照顾|照料|陪你|陪我|担心你|别怕|保重|对不起|抱歉/g],
};
const topicRules: Record<Exclude<Topic, 'other'>, RegExp[]> = {
  survival: [
    /食物|口粮|饥饿|吃|饮水|喝|水源|果|坚果|根茎|鱼|肉|\b(?:food|nuts|berries|roots|fish|meat|water)\b/g,
  ],
  industry: [
    /木|石片|石斧|绳|工具|骨针|纤维|纺|织|陶|炭|矿|铜|锡|铁|炉|\b(?:wood|cord|fiber|flake|pot|ore|charcoal|basket)\b/g,
  ],
  farming: [
    /农|田|种子|播种|耕|谷|收割|秋种|春种|灌溉|施肥|\b(?:farming|grain|winter_grain|field|pulses|flax)\b/g,
  ],
  building: [
    /建造|建筑|房|棚|粮仓|仓储|储存|工棚|屋|桥|码头|\b(?:build|granary|shelter|storage)\b/g,
  ],
  logistics: [
    /搬运|搬来|带来|送到|运到|会合|汇合|迁居|河谷|铜山|锡岭|坐标|\(\d{1,2}\s*[,，]\s*\d{1,2}\)/g,
  ],
  health: [/孤单|抑郁|受伤|中毒|生病|血量|生命|难受|疼|照料|照顾|健康|冷|保暖/g],
  reproduction: [/繁衍|交配|受孕|怀孕|妊娠|后代|生育|孩子|伴侣/g],
  norms: [/共享|公用|公共|分配|均分|平分|归谁|属于|所有权|约定|规矩|规则|欠|偿还|先到先得/g],
};
export type Speech = Pick<
  WorldEvent,
  'seq' | 'day' | 'type' | 'text' | 'actorId' | 'decisionId' | 'targetId'
> & { recipients: number[] };
export interface ClassifiedSpeech extends Speech {
  body: string;
  listeners: number[];
  intents: Intent[];
  topics: Topic[];
  primary: Intent;
  evidence: Record<string, string[]>;
}
export function speechEvent(e: Omit<WorldEvent, 'patch'>): Speech | undefined {
  if (!e.success || !['chat', 'shout', 'public_speak'].includes(e.type) || e.actorId === undefined)
    return;
  return {
    seq: e.seq,
    day: e.day,
    type: e.type,
    text: e.text,
    actorId: e.actorId,
    decisionId: e.decisionId,
    targetId: e.targetId,
    recipients: e.recipients ?? [],
  };
}
export function speechBody(text: string) {
  const match = text.match(/(?:公开说|大声说|说)\s*[：:]\s*[“"]([\s\S]*)[”"]/);
  return (match?.[1] ?? text).trim();
}
export function classify(s: Speech): ClassifiedSpeech {
  const body = speechBody(s.text),
    lower = body.normalize('NFKC').toLowerCase();
  const evidence: Record<string, string[]> = {};
  function hits<T extends string>(rules: Record<T, RegExp[]>, prefix: string): T[] {
    const result: T[] = [];
    for (const [id, patterns] of Object.entries(rules) as [T, RegExp[]][]) {
      const matches = [
        ...new Set(patterns.flatMap((p) => [...lower.matchAll(p)].map((m) => m[0]))),
      ];
      // A nearby explicit negation suppresses affirmative cues in its clause.
      const filtered =
        prefix === 'intent' && ['agree', 'offer', 'cooperate', 'teach'].includes(id)
          ? matches.filter((word) =>
              [
                ...lower.matchAll(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
              ].some(
                (m) =>
                  !/(?:不|没|别|无法|不能|不想|不愿|不再|不需要).{0,3}$/.test(
                    lower.slice(Math.max(0, m.index! - 6), m.index),
                  ),
              ),
            )
          : matches;
      if (filtered.length) {
        result.push(id);
        evidence[`${prefix}:${id}`] = filtered.slice(0, 4);
      }
    }
    return result;
  }
  const intents: Intent[] = hits(intentRules, 'intent'),
    topics: Topic[] = hits(topicRules, 'topic');
  if (!intents.length) intents.push('other');
  if (!topics.length) topics.push('other');
  const primary = [...intents].sort(
    (a, b) => (evidence[`intent:${b}`]?.length ?? 0) - (evidence[`intent:${a}`]?.length ?? 0),
  )[0];
  return {
    ...s,
    body,
    listeners: [...new Set(s.recipients)].filter((id) => id !== s.actorId),
    intents,
    topics,
    primary,
    evidence,
  };
}
export interface Filters {
  start?: number;
  end?: number;
  agent?: number;
  intent?: string;
  topic?: string;
  q?: string;
  channel?: string;
  heardOnly?: boolean;
  edge?: [number, number];
}
export function filterSpeech(rows: ClassifiedSpeech[], f: Filters) {
  return rows.filter(
    (r) =>
      (f.start === undefined || r.day >= f.start) &&
      (f.end === undefined || r.day <= f.end) &&
      (!f.agent || r.actorId === f.agent || r.listeners.includes(f.agent)) &&
      (!f.intent || r.intents.includes(f.intent as Intent)) &&
      (!f.topic || r.topics.includes(f.topic as Topic)) &&
      (!f.q || r.body.toLowerCase().includes(f.q.trim().toLowerCase())) &&
      (!f.channel || r.type === f.channel) &&
      (!f.heardOnly || r.listeners.length > 0) &&
      (!f.edge || (r.actorId === f.edge[0] && r.listeners.includes(f.edge[1]))),
  );
}
export function summarize(rows: ClassifiedSpeech[]) {
  const intents = Object.keys(INTENTS).map((id) => ({
    id,
    name: INTENTS[id as Intent],
    count: rows.filter((r) => r.intents.includes(id as Intent)).length,
  }));
  const topics = Object.keys(TOPICS).map((id) => ({
    id,
    name: TOPICS[id as Topic],
    count: rows.filter((r) => r.topics.includes(id as Topic)).length,
  }));
  const pairs = new Map<string, { from: number; to: number; count: number }>(),
    days = new Map<
      number,
      { day: number; total: number; cooperate: number; teach: number; conflict: number }
    >();
  const speakers = new Map<number, number>();
  for (const r of rows) {
    speakers.set(r.actorId!, (speakers.get(r.actorId!) ?? 0) + 1);
    for (const id of r.listeners) {
      const key = `${r.actorId}:${id}`;
      const pair = pairs.get(key) ?? { from: r.actorId!, to: id, count: 0 };
      pair.count++;
      pairs.set(key, pair);
    }
    const day = days.get(r.day) ?? { day: r.day, total: 0, cooperate: 0, teach: 0, conflict: 0 };
    day.total++;
    for (const intent of ['cooperate', 'teach', 'conflict'] as const)
      if (r.intents.includes(intent)) day[intent]++;
    days.set(r.day, day);
  }
  const timeline = [...days.values()].sort((a, b) => a.day - b.day);
  if (timeline.length)
    for (let day = timeline[0].day; day <= timeline.at(-1)!.day; day++)
      if (!days.has(day)) days.set(day, { day, total: 0, cooperate: 0, teach: 0, conflict: 0 });
  return {
    total: rows.length,
    speakers: [...speakers].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    publicSpeak: rows.filter((r) => r.type === 'public_speak').length,
    shout: rows.filter((r) => r.type === 'shout').length,
    unclassified: rows.filter((r) => r.primary === 'other').length,
    unheard: rows.filter((r) => !r.listeners.length).length,
    intents,
    topics,
    edges: [...pairs.values()],
    timeline: [...days.values()].sort((a, b) => a.day - b.day),
  };
}

function grams(text: string) {
  const chunks =
    text
      .toLowerCase()
      .normalize('NFKC')
      .match(/[\p{Script=Han}]+|[a-z_]+/gu) ?? [];
  const terms: string[] = [];
  for (const chunk of chunks) {
    if (/^[a-z_]+$/.test(chunk)) terms.push(chunk);
    else for (let i = 0; i < chunk.length - 1; i++) terms.push(chunk.slice(i, i + 2));
  }
  return terms;
}
/** Character bigrams + ASCII words, log TF / smoothed IDF, cosine retrieval. */
export class SimilarityIndex {
  private vectors: Map<string, number>[] = [];
  private postings = new Map<string, number[]>();
  constructor(private rows: ClassifiedSpeech[]) {
    const counts = rows.map((r) => {
      const m = new Map<string, number>();
      for (const term of grams(r.body)) m.set(term, (m.get(term) ?? 0) + 1);
      return m;
    });
    const df = new Map<string, number>();
    for (const c of counts) for (const key of c.keys()) df.set(key, (df.get(key) ?? 0) + 1);
    this.vectors = counts.map((c, i) => {
      let norm = 0;
      const v = new Map<string, number>();
      for (const [key, n] of c) {
        const w = (1 + Math.log(n)) * (1 + Math.log((rows.length + 1) / (df.get(key)! + 1)));
        v.set(key, w);
        norm += w * w;
        const list = this.postings.get(key) ?? [];
        list.push(i);
        this.postings.set(key, list);
      }
      norm = Math.sqrt(norm);
      if (norm) for (const [key, w] of v) v.set(key, w / norm);
      return v;
    });
  }
  similar(seq: number, allowed: Set<number>) {
    const i = this.rows.findIndex((r) => r.seq === seq);
    if (i < 0) return [];
    const scores = new Map<number, number>();
    for (const [term, w] of this.vectors[i])
      for (const j of this.postings.get(term) ?? [])
        if (j !== i && allowed.has(this.rows[j].seq))
          scores.set(j, (scores.get(j) ?? 0) + w * (this.vectors[j].get(term) ?? 0));
    return [...scores]
      .filter(([, score]) => score >= 0.15)
      .sort((a, b) => b[1] - a[1] || this.rows[b[0]].seq - this.rows[a[0]].seq)
      .slice(0, 5)
      .map(([j, score]) => ({ row: this.rows[j], score: Math.min(1, score) }));
  }
}
