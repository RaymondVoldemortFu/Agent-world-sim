import { useEffect, useRef, useState } from 'react';
import { clockLabel, type Event, type World, type Plan } from './types';

type Row = Omit<Event, 'patch'> & { source: 'observed' | 'heard' | 'inferred'; plan?: Plan };
type Result = { rows: Row[]; nextCursor: number | null; through: number };
const sources = {
  observed: '亲历 / 执行结果',
  heard: '听闻（发言 / 环境声）',
  inferred: '计划 / 判断',
};
export default function ContinuousExperiences({
  world,
  agentId,
  onAgent,
  onReplay,
  historical,
}: {
  world?: World;
  agentId: number;
  onAgent: (id: number) => void;
  onReplay: (time: number) => Promise<void>;
  historical: boolean;
}) {
  const [query, setQuery] = useState(''),
    [needle, setNeedle] = useState(''),
    [source, setSource] = useState('');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ scope: string; before: number; through: number }>();
  const [result, setResult] = useState<Result & { scope: string }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const latest = useRef(world);
  latest.current = world;
  const scope = JSON.stringify([
    world?.id,
    agentId,
    needle,
    source,
    start,
    end,
    revision,
    historical,
    historical ? world?.seq : null,
  ]);
  const before = page?.scope === scope ? page.before : undefined,
    through = page?.scope === scope ? page.through : undefined;
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const w = latest.current;
    if (!w) return;
    const abort = new AbortController();
    setBusy(true);
    setError('');
    const run = async () => {
      try {
        if (start && end && Number(start) > Number(end)) throw Error('起始日不能晚于结束日');
        const params = new URLSearchParams({
          agent_id: String(agentId),
          q: needle,
          source,
          through: String(through ?? w.seq),
          limit: '60',
        });
        if (before) params.set('before', String(before));
        if (start) params.set('start_day', start);
        if (end) params.set('end_day', end);
        const r = await fetch(
          `/continuous-api/runs/${encodeURIComponent(w.id)}/experiences?${params}`,
          { signal: abort.signal },
        );
        const data = await r.json();
        if (!r.ok) throw Error(data.detail ?? data.error ?? '无法读取经历');
        if (!abort.signal.aborted)
          setResult((old) => ({
            ...data,
            scope,
            rows: before && old?.scope === scope ? [...old.rows, ...data.rows] : data.rows,
          }));
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    };
    void run();
    return () => abort.abort();
  }, [scope, before, through]);
  const rows = result?.scope === scope ? result.rows : [];
  return (
    <section className="data-page" aria-label="Agent经历查询">
      <div className="data-heading">
        <div>
          <p className="eyebrow">AGENT EXPERIENCES</p>
          <h2>沿着一个人的经历</h2>
          <p>查询已提交的计划、实际行动与交流。听众按说话完成时的真实范围记录。</p>
        </div>
        <label>
          选择 Agent
          <select
            aria-label="经历查询居民"
            value={agentId}
            onChange={(e) => onAgent(Number(e.target.value))}
          >
            {world?.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} #{a.id}
                {a.dead ? ' · 已死亡' : a.away ? ' · 已离境' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="experience-filters">
        <label>
          关键词
          <input
            aria-label="经历关键词"
            maxLength={500}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="人物、对话或行动内容…"
          />
        </label>
        <label>
          来源
          <select aria-label="经历来源" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">全部来源</option>
            {Object.entries(sources).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          起始日
          <input
            aria-label="经历起始日"
            type="number"
            min="1"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          结束日
          <input
            aria-label="经历结束日"
            type="number"
            min="1"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          刷新经历
        </button>
      </div>
      <p role="status">
        {busy
          ? '正在检索…'
          : `已载入 ${rows.length} 条 · 查询截止 E${result?.scope === scope ? result.through : (world?.seq ?? 0)}${historical ? ' · 历史回放' : ''}`}
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!busy && !rows.length && !error && <p className="note">暂无符合条件的经历。</p>}
      {rows.map((row) => (
        <article key={row.seq} className="data-panel">
          <header>
            {clockLabel(row.time)} · E{row.seq} · {sources[row.source]} · #{row.actor ?? '世界'} ·{' '}
            {row.type}
          </header>
          <p style={{ whiteSpace: 'pre-wrap' }}>{row.text}</p>
          {row.plan && (
            <details>
              <summary>查看当时的任务与自动日程</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.plan, null, 2)}</pre>
            </details>
          )}
          <button
            disabled={busy}
            onClick={() => void onReplay(row.time).catch((e) => setError(String(e)))}
          >
            回到此刻
          </button>
        </article>
      ))}
      <button
        disabled={busy || result?.scope !== scope || !result?.nextCursor}
        onClick={() => setPage({ scope, before: result!.nextCursor!, through: result!.through })}
      >
        加载更早经历
      </button>
    </section>
  );
}
