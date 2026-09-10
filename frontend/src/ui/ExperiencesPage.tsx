import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../sim/types';
import { LocalExperiences, type Experience } from '../runtime/experiences';
import { eventNames } from '../runtime/event-search';
import { goalNames, number as n } from './world-statistics';
const sources = { observed: '亲历 / 目击', heard: '听闻', inferred: '个人判断' };
export default function ExperiencesPage({
  world: w,
  externalName,
  agentId,
  onAgent,
  onInspect,
  historical,
}: {
  world?: World;
  externalName?: string;
  agentId?: number;
  onAgent: (id: number) => void;
  onInspect: (id: string) => Promise<boolean>;
  historical: boolean;
}) {
  const person = w?.agents.find((a) => a.id === agentId) ?? w?.agents[0];
  const [query, setQuery] = useState(''),
    [needle, setNeedle] = useState(''),
    [source, setSource] = useState('');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [inspecting, setInspecting] = useState(false);
  const [expanded, setExpanded] = useState<number>();
  const scope = useMemo(
    () => Symbol('experiences'),
    [
      w?.id,
      externalName,
      person?.id,
      needle,
      source,
      start,
      end,
      revision,
      historical,
      historical ? w?.seq : undefined,
    ],
  );
  const [page, setPage] = useState<{ scope: symbol; before?: number; through?: number }>();
  const [result, setResult] = useState<{
    scope: symbol;
    rows: Experience[];
    next?: number;
    through: number;
  }>();
  const latest = useRef(w);
  latest.current = w;
  const local = useMemo(() => (w ? new LocalExperiences(w.id) : undefined), [w?.id]);
  const before = page?.scope === scope ? page.before : undefined;
  const boundary = page?.scope === scope ? page.through : undefined;
  // Historical replay changes constitute a different snapshot; live updates are explicit.
  const historicalSeq = historical ? w?.seq : undefined;
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query), 350);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!latest.current || !person) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setExpanded(undefined);
    const run = async () => {
      try {
        if (start && end && Number(start) > Number(end)) throw Error('起始日不能晚于结束日');
        const through = boundary ?? latest.current!.seq;
        let data: { experiences: Experience[]; nextCursor: number | null; through: number };
        if (externalName) {
          const params = new URLSearchParams({
            agent_id: String(person.id),
            q: needle,
            source,
            limit: '60',
            through: String(through),
          });
          if (start) params.set('start_day', start);
          if (end) params.set('end_day', end);
          if (before) params.set('before', String(before));
          const response = await fetch(
            `/api/experiments/${encodeURIComponent(externalName)}/experiences?${params}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw Error('无法读取经历，请重试。首次读取旧实验需要建立经历索引。');
          data = await response.json();
        } else
          data = await local!.query({
            agentId: person.id,
            q: needle,
            source,
            start: start ? Number(start) : undefined,
            end: end ? Number(end) : undefined,
            through,
            before,
          });
        if (active)
          setResult((old) => ({
            scope,
            through: data.through,
            next: data.nextCursor ?? undefined,
            rows:
              before && old?.scope === scope
                ? [...old.rows.filter((r) => r.cursor >= before), ...data.experiences]
                : data.experiences,
          }));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    scope,
    before,
    boundary,
    historicalSeq,
    externalName,
    person?.id,
    needle,
    source,
    start,
    end,
    local,
  ]);
  if (!w || !person)
    return (
      <section className="data-page">
        <h2>Agent 经历</h2>
        <p>生成或选择一份实验后查询居民经历。</p>
      </section>
    );
  const rows = result?.scope === scope ? result.rows : [];
  const busy = loading || query !== needle;
  return (
    <section className="data-page" aria-label="Agent经历查询">
      <div className="data-heading">
        <div>
          <p className="eyebrow">AGENT EXPERIENCES</p>
          <h2>沿着一个人的经历</h2>
          <p className="muted">
            查询历史日志中记录的亲历、听闻与判断；其中有些已不在角色当前记忆中。
          </p>
        </div>
        <label>
          选择 Agent
          <select
            aria-label="经历查询居民"
            value={person.id}
            onChange={(e) => onAgent(Number(e.target.value))}
          >
            {w.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} #{a.id} · {a.death ? '已死亡' : a.sex === 'F' ? '女性' : '男性'}
                {a.role === 'prophet' ? ' · 先知' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="agent-summary">
        <div>
          <h3>
            {person.name} #{person.id} {person.role === 'prophet' ? '· 先知' : ''}
          </h3>
          <p>
            {person.death
              ? `第 ${person.death.day} 天死亡 · ${person.death.cause}`
              : `存活 · 生命 ${n(person.hp)} · 饱食 ${n(person.hunger)} · 孤单 ${n(person.social?.loneliness ?? 0)}`}
          </p>
        </div>
        <div>
          <span>当前目标</span>
          <strong>{person.brain?.goal ? goalNames[person.brain.goal.skill] : '暂无目标'}</strong>
        </div>
        <div>
          <span>当前保留记忆</span>
          <strong>{person.memories.length} 条</strong>
        </div>
        <div>
          <span>查询范围</span>
          <strong>
            {historical ? '历史回放' : '已提交历史'} #
            {result?.scope === scope ? result.through : w.seq}
          </strong>
        </div>
      </div>
      <div className="experience-filters">
        <label>
          关键词
          <input
            aria-label="经历关键词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="人物、对话或经历内容…"
            maxLength={500}
          />
        </label>
        <label>
          来源
          <select aria-label="经历来源" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">全部来源</option>
            {Object.entries(sources).map(([k, v]) => (
              <option key={k} value={k}>
                {k === 'heard' ? '交流（听闻 / 本人发言）' : v}
              </option>
            ))}
          </select>
        </label>
        <label>
          起始日
          <input
            aria-label="经历起始日"
            type="number"
            min="0"
            step="1"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          结束日
          <input
            aria-label="经历结束日"
            type="number"
            min="0"
            step="1"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
          刷新经历
        </button>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="experience-list">
        {rows.map((r) => (
          <article className="experience-row" key={`${r.agentId}:${r.id}`}>
            <div className="experience-meta">
              <span>第 {r.day} 天</span>
              <span className={`memory-source ${r.source}`}>
                {r.source === 'heard' && r.speakerId === person.id ? '本人发言' : sources[r.source]}
              </span>
              <small>
                #{r.seq} · {eventNames[r.eventType] ?? r.eventType}
              </small>
              {r.speakerId !== undefined && (
                <small>
                  讲述者：{w.agents.find((a) => a.id === r.speakerId)?.name ?? '居民'} #
                  {r.speakerId}
                </small>
              )}
            </div>
            <p>{r.content}</p>
            <button
              className="text-button"
              aria-expanded={expanded === r.cursor}
              onClick={() => setExpanded(expanded === r.cursor ? undefined : r.cursor)}
            >
              来源详情 {expanded === r.cursor ? '收起' : '展开'}
            </button>
            {expanded === r.cursor && (
              <div className="experience-detail">
                <p>
                  记忆来源事件：{r.eventIds.map((id) => `#${id}`).join('、') || '未标注'} · 重要性{' '}
                  {r.importance}
                </p>
                {r.position && <p>关联事件地点：({r.position.join(', ')})</p>}
                {r.decisionId && (
                  <button
                    disabled={inspecting}
                    onClick={async () => {
                      setInspecting(true);
                      try {
                        if (!(await onInspect(r.decisionId!)))
                          setError('这条经历的关联事件没有单独的决策记录。');
                      } catch {
                        setError('决策记录读取失败，请重试。');
                      } finally {
                        setInspecting(false);
                      }
                    }}
                  >
                    查看关联行动的决策
                  </button>
                )}
                <p className="muted">关联行动的决策属于行动发起者；听闻和个人判断保留角色视角。</p>
              </div>
            )}
          </article>
        ))}
        {!rows.length && (
          <p className="data-empty">
            {busy
              ? '正在读取经历…首次读取旧实验会建立索引。'
              : error
                ? '请调整筛选或刷新重试。'
                : '没有符合筛选条件的已记录经历。'}
          </p>
        )}
      </div>
      <div className="timeline-bottom">
        <button
          disabled={busy || !result || result.scope !== scope || result.next === undefined}
          onClick={() => result && setPage({ scope, before: result.next, through: result.through })}
        >
          加载更早经历
        </button>
        <span role="status">{busy ? '正在查询…' : `已显示 ${rows.length} 条 · 每页 60 条`}</span>
      </div>
    </section>
  );
}
