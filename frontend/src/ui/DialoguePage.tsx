import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import type { World } from '../sim/types';
import {
  INTENTS,
  TOPICS,
  VERSION,
  type Filters,
  type ClassifiedSpeech,
  summarize,
} from '../analysis/dialogue';
type Analysis = {
  corpus: number;
  summary: ReturnType<typeof summarize>;
  rows: ClassifiedSpeech[];
  offset: number;
  hasMore: boolean;
};
const colors = ['#baca86', '#77b8b2', '#c9a476', '#ac95bc', '#869fc7', '#c2b775'];
function Counts({
  title,
  rows,
  onSelect,
  selected,
}: {
  title: string;
  rows: { id: string; name: string; count: number }[];
  onSelect: (id: string) => void;
  selected: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="data-panel">
      <h3>{title}</h3>
      <div className="nlp-bars">
        {[...rows]
          .sort((a, b) => b.count - a.count)
          .map((r, i) => (
            <button
              key={r.id}
              aria-pressed={selected === r.id}
              onClick={() => onSelect(selected === r.id ? '' : r.id)}
            >
              <span>{r.name}</span>
              <i>
                <b
                  style={{
                    width: `${(100 * r.count) / max}%`,
                    background: colors[i % colors.length],
                  }}
                />
              </i>
              <strong>{r.count}</strong>
            </button>
          ))}
      </div>
    </section>
  );
}
function HearingMap({
  summary,
  names,
  onSelect,
}: {
  summary: Analysis['summary'];
  names: Map<number, string>;
  onSelect: (edge: [number, number]) => void;
}) {
  const ids = [...new Set(summary.edges.flatMap((e) => [e.from, e.to]))].sort((a, b) => a - b);
  const max = Math.max(1, ...summary.edges.map((e) => e.count));
  const cell = 26,
    left = 100,
    top = 55;
  const counts = new Map(summary.edges.map((e) => [`${e.from}:${e.to}`, e.count]));
  return (
    <section className="data-panel">
      <h3>发言者 → 实际听众</h3>
      <p className="muted">
        纵轴发言者，横轴听众。每格表示被听见的发言次数；广播会连接多位听众，连线次数不等于对话条数。点击格子筛选。
      </p>
      {ids.length ? (
        <div className="nlp-matrix">
          <svg
            role="group"
            aria-label="Agent交流热力图"
            width={left + ids.length * cell + 10}
            height={top + ids.length * cell + 10}
          >
            {ids.map((id, i) => (
              <g key={id}>
                <text x={left + i * cell + cell / 2} y={top - 15} textAnchor="middle">
                  #{id}
                </text>
                <text x={left - 10} y={top + i * cell + 17} textAnchor="end">
                  {names.get(id)} #{id}
                </text>
              </g>
            ))}
            {ids.flatMap((from, y) =>
              ids.map((to, x) => {
                const count = counts.get(`${from}:${to}`) ?? 0;
                return (
                  <rect
                    key={`${from}:${to}`}
                    x={left + x * cell + 1}
                    y={top + y * cell + 1}
                    width={cell - 2}
                    height={cell - 2}
                    rx={3}
                    fill={
                      count
                        ? `rgba(190,213,140,${0.18 + 0.82 * Math.sqrt(count / max)})`
                        : '#243128'
                    }
                    role={count ? 'button' : undefined}
                    tabIndex={count ? 0 : undefined}
                    aria-label={`${names.get(from)} #${from} → ${names.get(to)} #${to}：${count} 次`}
                    onClick={() => count && onSelect([from, to])}
                    onKeyDown={(e) => {
                      if (count && ['Enter', ' '].includes(e.key)) {
                        e.preventDefault();
                        onSelect([from, to]);
                      }
                    }}
                  >
                    <title>
                      {names.get(from)} #{from} → {names.get(to)} #{to}：{count} 次
                    </title>
                  </rect>
                );
              }),
            )}
          </svg>
        </div>
      ) : (
        <p className="data-empty">当前筛选没有实际听众关系。</p>
      )}
    </section>
  );
}
export default function DialoguePage({
  world: w,
  externalName,
  historical,
  onInspect,
}: {
  world?: World;
  externalName?: string;
  historical: boolean;
  onInspect: (id: string) => Promise<boolean>;
}) {
  const worker = useRef<Worker | null>(null),
    latest = useRef(w);
  latest.current = w;
  const [revision, setRevision] = useState(0),
    [through, setThrough] = useState(0),
    [loaded, setLoaded] = useState(0);
  const [query, setQuery] = useState(''),
    [needle, setNeedle] = useState('');
  const [agent, setAgent] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const [intent, setIntent] = useState(''),
    [topic, setTopic] = useState(''),
    [channel, setChannel] = useState('');
  const [heardOnly, setHeardOnly] = useState(true),
    [edge, setEdge] = useState<[number, number]>();
  const [offset, setOffset] = useState(0),
    [data, setData] = useState<Analysis>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<ClassifiedSpeech>(),
    [similar, setSimilar] = useState<{ row: ClassifiedSpeech; score: number }[]>([]),
    [similarLoading, setSimilarLoading] = useState(false);
  const request = useRef(0),
    selection = useRef<number | undefined>(undefined);
  const historicalSeq = historical ? w?.seq : undefined;
  const names = useMemo(() => new Map(w?.agents.map((a) => [a.id, a.name])), [w?.agents]);
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const filters = useMemo<Filters>(
    () => ({
      q: needle,
      agent: agent ? Number(agent) : undefined,
      start: start ? Number(start) : undefined,
      end: end ? Number(end) : undefined,
      intent,
      topic,
      channel,
      heardOnly,
      edge,
    }),
    [needle, agent, start, end, intent, topic, channel, heardOnly, edge],
  );
  const valid =
    (!start || (Number.isInteger(Number(start)) && Number(start) >= 0)) &&
    (!end || (Number.isInteger(Number(end)) && Number(end) >= 0)) &&
    (!start || !end || Number(start) <= Number(end));
  useEffect(() => {
    setOffset(0);
    setSelected(undefined);
    setSimilar([]);
    selection.current = undefined;
  }, [filters]);
  useEffect(() => {
    const world = latest.current;
    if (!world) return;
    const instance = new Worker(new URL('../analysis/dialogue.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = instance;
    setLoading(true);
    setError('');
    setData(undefined);
    setLoaded(0);
    setThrough(world.seq);
    setSelected(undefined);
    selection.current = undefined;
    instance.onmessage = ({ data: message }) => {
      if (message.type === 'progress') setLoaded(message.count);
      else if (message.type === 'result' && message.requestId === request.current) {
        setData(message);
        setLoading(false);
      } else if (
        message.type === 'similar' &&
        message.requestId === request.current &&
        message.seq === selection.current
      ) {
        setSimilar(message.matches);
        setSimilarLoading(false);
      } else if (message.type === 'error') {
        setError(message.message);
        setLoading(false);
      }
    };
    instance.onerror = () => {
      setError('分析任务中断，请刷新分析重试');
      setLoading(false);
    };
    instance.postMessage({
      type: 'load',
      external: externalName,
      runId: world.id,
      through: world.seq,
    });
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, [w?.id, externalName, revision, historicalSeq]);
  useEffect(() => {
    if (!worker.current || !valid) return;
    request.current++;
    setLoading(true);
    setError('');
    worker.current.postMessage({ type: 'query', requestId: request.current, filters, offset });
  }, [filters, offset, valid, w?.id, externalName, revision, historicalSeq]);
  function inspectSimilar(row: ClassifiedSpeech) {
    setSelected(row);
    setSimilar([]);
    setSimilarLoading(true);
    selection.current = row.seq;
    worker.current?.postMessage({ type: 'similar', seq: row.seq, requestId: request.current });
  }
  if (!w)
    return (
      <section className="data-page">
        <h2>对话分析</h2>
        <p>生成或选择一份实验后分析 Agent 对话。</p>
      </section>
    );
  return (
    <section className="data-page" aria-label="对话NLP分析">
      <div className="data-heading">
        <div>
          <p className="eyebrow">LANGUAGE & SOCIETY</p>
          <h2>对话如何组织生活</h2>
          <p className="muted">
            本地词组规则 · 字符 TF‑IDF 相似检索 · {historical ? '历史回放' : '已提交历史'} #
            {through}
          </p>
        </div>
        <button disabled={loading && !error} onClick={() => setRevision((v) => v + 1)}>
          刷新分析
        </button>
      </div>
      <details className="data-panel nlp-method">
        <summary>分析方法与口径</summary>
        <p>
          意图与主题采用可解释规则（{VERSION}
          ），一句话可有多个标签；点击原文查看命中的词组。标签表示措辞线索，不能证明承诺已经履行，也可能漏判省略、反讽和复杂否定。
        </p>
        <p>
          相似表达使用中文双字片段与英文词的 TF‑IDF
          余弦相似度，在本次载入的对话语料上拟合。它衡量措辞重合，不代表语义等价；仅展示当前筛选内分数≥0.15的前五条，分数不是分类置信度。
        </p>
        <p>
          统计成功发生的聊天、公开发言与喊话，每个事件只计一次；不重复计算不同听众的记忆副本。默认只统计有他人听见的发言。Agent
          筛选包含他的发言及听到的话。计算在浏览器后台线程完成，筛选和相似检索不调用 LLM。
        </p>
      </details>
      <div className="experience-filters nlp-filters">
        <label>
          关键词
          <input
            aria-label="对话关键词"
            placeholder="筛选对话内容…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={500}
          />
        </label>
        <label>
          Agent
          <select
            aria-label="分析Agent"
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
              setEdge(undefined);
            }}
          >
            <option value="">所有 Agent</option>
            {w.agents.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name} #{a.id}
                {a.death ? ' · 已死亡' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          意图
          <select aria-label="对话意图" value={intent} onChange={(e) => setIntent(e.target.value)}>
            <option value="">全部意图</option>
            {Object.entries(INTENTS).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          主题
          <select aria-label="对话主题" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">全部主题</option>
            {Object.entries(TOPICS).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          渠道
          <select
            aria-label="对话渠道"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">全部发言</option>
            <option value="chat">聊天</option>
            <option value="public_speak">公开发言</option>
            <option value="shout">喊话</option>
          </select>
        </label>
        <label>
          起始日
          <input
            aria-label="分析起始日"
            type="number"
            min="0"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          结束日
          <input
            aria-label="分析结束日"
            type="number"
            min="0"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <div className="nlp-options">
        <label>
          <input
            type="checkbox"
            checked={heardOnly}
            onChange={(e) => setHeardOnly(e.target.checked)}
          />{' '}
          仅统计有他人听见的发言
        </label>
        {edge && (
          <button onClick={() => setEdge(undefined)}>
            清除关系筛选：#{edge[0]} → #{edge[1]} ×
          </button>
        )}
      </div>
      {!valid && (
        <p className="alert" role="alert">
          日期须为非负整数，且起始日不晚于结束日。
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <p role="status" className="muted">
        {loading
          ? `正在分析，已读取 ${loaded} 条对话…`
          : `已载入 ${data?.corpus ?? 0} 条成功发言 · 当前筛选 ${data?.summary.total ?? 0} 条`}
      </p>
      {data && valid && !loading && (
        <>
          <div className="data-cards">
            {[
              ['筛选内发言', data.summary.total],
              ['发言 Agent', data.summary.speakers.length],
              ['喊话', data.summary.shout],
              ['公开发言', data.summary.publicSpeak],
              ['意图未分类', data.summary.unclassified],
            ].map(([k, v]) => (
              <article className="data-card" key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </article>
            ))}
          </div>
          <p className="muted">
            同一条对话可命中多个意图和主题，柱状图计数之和可能超过发言总数。无他人听见的发言：
            {data.summary.unheard} 条。
          </p>
          <div className="data-grid">
            <Counts
              title="对话意图"
              rows={data.summary.intents}
              selected={intent}
              onSelect={setIntent}
            />
            <Counts
              title="对话主题"
              rows={data.summary.topics}
              selected={topic}
              onSelect={setTopic}
            />
          </div>
          <section className="data-panel">
            <h3>随时间变化的对话</h3>
            {data.summary.timeline.length ? (
              <div className="stats-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.summary.timeline}>
                    <CartesianGrid stroke="#324237" strokeDasharray="3 6" />
                    <XAxis dataKey="day" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#19291f', borderColor: '#51654c' }}
                      labelFormatter={(v) => `第 ${v} 天`}
                    />
                    <Legend />
                    {[
                      ['total', '全部发言'],
                      ['cooperate', '协作 / 分工'],
                      ['teach', '知识传授'],
                      ['conflict', '争执 / 威胁'],
                    ].map(([key, name], i) => (
                      <Area
                        key={key}
                        dataKey={key}
                        name={name}
                        stroke={colors[i]}
                        fill={colors[i]}
                        fillOpacity={0.08}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>当前筛选没有对话。</p>
            )}
          </section>
          <HearingMap summary={data.summary} names={names} onSelect={setEdge} />
          <section className="data-panel">
            <h3>原文与分类依据</h3>
            <div className="experience-list">
              {data.rows.map((r) => (
                <article className="experience-row" key={r.seq}>
                  <div className="experience-meta">
                    <span>
                      第 {r.day} 天 · #{r.seq}
                    </span>
                    <b>
                      {names.get(r.actorId!)} #{r.actorId}
                    </b>
                    <span>
                      {r.type === 'shout'
                        ? '喊话'
                        : r.type === 'public_speak'
                          ? '公开发言'
                          : '聊天'}{' '}
                      · 听众 {r.listeners.map((id) => `${names.get(id)} #${id}`).join('、') || '无'}
                    </span>
                  </div>
                  <p>{r.body}</p>
                  <div className="data-chips">
                    {r.intents.map((id) => (
                      <span key={id}>{INTENTS[id]}</span>
                    ))}
                    {r.topics.map((id) => (
                      <span key={id}>{TOPICS[id]}</span>
                    ))}
                  </div>
                  <div className="nlp-row-actions">
                    <button onClick={() => inspectSimilar(r)}>分类依据与相似表达</button>
                    <button
                      onClick={async () => {
                        try {
                          if (!(await onInspect(r.decisionId)))
                            setError('该对话没有独立决策记录。');
                        } catch {
                          setError('读取决策失败，请重试。');
                        }
                      }}
                    >
                      关联决策
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!data.rows.length && <p className="data-empty">没有符合条件的对话。</p>}
            <div className="timeline-bottom">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 60))}>
                上一页对话
              </button>
              <span>第 {Math.floor(offset / 60) + 1} 页 · 每页60条</span>
              <button disabled={!data.hasMore} onClick={() => setOffset(offset + 60)}>
                下一页对话
              </button>
            </div>
          </section>
        </>
      )}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(undefined)}>
          <div
            className="modal"
            role="dialog"
            aria-label="分类依据与相似表达"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setSelected(undefined)}>
              ×
            </button>
            <h2>措辞与相似表达</h2>
            <p>{selected.body}</p>
            <h3>规则命中依据</h3>
            {Object.entries(selected.evidence).map(([key, words]) => (
              <p key={key}>
                <b>
                  {key.startsWith('intent:')
                    ? INTENTS[key.slice(7) as keyof typeof INTENTS]
                    : TOPICS[key.slice(6) as keyof typeof TOPICS]}
                </b>
                ：{words.join(' · ')}
              </p>
            ))}
            {!Object.keys(selected.evidence).length && <p>当前规则没有命中线索。</p>}
            <h3>当前筛选中的相似表达</h3>
            <p className="muted">TF‑IDF 余弦分数，仅衡量措辞重合。</p>
            {similarLoading ? (
              <p>正在检索…</p>
            ) : similar.length ? (
              similar.map(({ row, score }) => (
                <article className="experience-row" key={row.seq}>
                  <small>
                    第{row.day}天 · #{row.seq} · {names.get(row.actorId!)} #{row.actorId} · 相似度{' '}
                    {score.toFixed(2)}
                  </small>
                  <p>{row.body}</p>
                </article>
              ))
            ) : (
              <p>没有达到相似度阈值的其他对话。</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
