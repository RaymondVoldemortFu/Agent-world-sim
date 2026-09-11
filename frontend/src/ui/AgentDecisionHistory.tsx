import { useEffect, useRef, useState } from 'react';
import type { World, Decision } from '../sim/types';
import { db } from '../runtime/store';
import { eventNames } from '../runtime/event-search';
type Row = {
  id: string;
  seq: number;
  day: number;
  source: string;
  decision?: Decision;
  attempts: number;
};
export default function AgentDecisionHistory({
  world,
  agentId,
  externalName,
  onInspect,
  historical,
}: {
  world: World;
  agentId: number;
  externalName?: string;
  onInspect?: (id: string) => Promise<boolean>;
  historical?: boolean;
}) {
  const [modelOnly, setModelOnly] = useState(false);
  const [rows, setRows] = useState<Row[]>([]),
    [before, setBefore] = useState<number>(),
    [next, setNext] = useState<number | null>(),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const latest = useRef(world);
  latest.current = world;
  const [through, setThrough] = useState(world.seq);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    (async () => {
      try {
        let data: { rows: Row[]; next: number | null };
        if (externalName) {
          const p = new URLSearchParams({
            agent_id: String(agentId),
            through: String(historical ? world.seq : through),
            limit: '20',
            model_only: String(modelOnly),
          });
          if (before) p.set('before', String(before));
          const r = await fetch(
            `/api/experiments/${encodeURIComponent(externalName)}/decision-history?${p}`,
            { signal: abort.signal },
          );
          if (!r.ok) throw Error('历史读取失败，请重试');
          data = await r.json();
        } else {
          const events = await db.events
            .where('[runId+seq]')
            .between([world.id, 0], [world.id, historical ? world.seq : through], true, true)
            .reverse()
            .filter(
              (e) =>
                e.type === 'action_started' && e.actorId === agentId && (!before || e.seq < before),
            )
            .limit(21)
            .toArray();
          const records = await db.decisions.bulkGet(events.slice(0, 20).map((e) => e.decisionId));
          data = {
            rows: events.slice(0, 20).flatMap((e, i) =>
              records[i] && (!modelOnly || records[i]!.attempts.length > 0)
                ? [
                    {
                      id: records[i]!.id,
                      seq: e.seq,
                      day: e.day,
                      source: records[i]!.source ?? 'rule',
                      decision: records[i]!.decision,
                      attempts: records[i]!.attempts.length,
                    },
                  ]
                : [],
            ),
            next: events.length > 20 ? events[19].seq : null,
          };
        }
        if (active) {
          setRows((old) => (before ? [...old, ...data.rows] : data.rows));
          setNext(data.next);
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      abort.abort();
    };
  }, [
    world.id,
    agentId,
    externalName,
    before,
    revision,
    modelOnly,
    through,
    historical,
    historical ? world.seq : undefined,
  ]);
  return (
    <section className="agent-decisions" aria-label="居民决策历史">
      <div className="decision-history-toolbar">
        <strong>决策历史</strong>
        <button
          disabled={loading}
          onClick={() => {
            setRows([]);
            setBefore(undefined);
            setThrough(latest.current.seq);
            setRevision((r) => r + 1);
          }}
        >
          刷新
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          checked={modelOnly}
          onChange={(e) => {
            setRows([]);
            setBefore(undefined);
            setNext(undefined);
            setModelOnly(e.target.checked);
          }}
        />{' '}
        只看含模型调用的决策
      </label>
      <p className="manor-muted">新到旧 · 点击展开实际动作；完整上下文按需打开。</p>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <details key={r.id} className="decision-history-card">
          <summary>
            <small>
              D{r.day} ·{' '}
              {r.source === 'llm' && r.attempts > 0
                ? 'LLM 决策'
                : r.source === 'plan'
                  ? '计划执行'
                  : r.source === 'fallback'
                    ? '降级规则'
                    : '规则执行'}
            </small>
            <span>{r.decision?.intent || '未记录意图'}</span>
          </summary>
          <p>
            <b>动作：</b>
            {r.decision?.action.type === 'manor' || r.decision?.action.type === 'eco'
              ? r.decision.action.op
              : (eventNames[r.decision?.action.type ?? ''] ?? r.decision?.action.type)}
          </p>
          <pre>{JSON.stringify(r.decision?.action, null, 2)}</pre>
          {r.decision?.memory_note && <p>{r.decision.memory_note}</p>}
          <button
            onClick={async () => {
              try {
                if (!(await onInspect?.(r.id))) setError('该决策的详细记录不可用');
              } catch {
                setError('详细记录读取失败');
              }
            }}
          >
            查看完整决策 / 上下文
          </button>
        </details>
      ))}
      {loading ? (
        <p role="status">读取中…</p>
      ) : !rows.length && !error ? (
        <p>{modelOnly ? '本批没有模型调用，可继续查看更早记录。' : '该居民在此时间点尚无决策。'}</p>
      ) : null}
      {next != null && (
        <button disabled={loading} onClick={() => setBefore(next)}>
          更早的决策
        </button>
      )}
    </section>
  );
}
