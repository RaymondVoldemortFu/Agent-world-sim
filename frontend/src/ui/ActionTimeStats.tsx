import { useEffect, useState } from 'react';
import type { World } from '../sim/types';
import { eventNames } from '../runtime/event-search';
type Row = {
  agentId: number;
  day: number;
  action: string;
  source: string;
  basic: boolean;
  minutes: number;
  starts: number;
  completed: number;
  failures: number;
};
export default function ActionTimeStats({
  world,
  externalName,
  historical,
}: {
  world: World;
  externalName?: string;
  historical: boolean;
}) {
  const [agent, setAgent] = useState('');
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [storage, setStorage] = useState('');
  const end = historical ? world.metrics.length : world.tick;
  useEffect(() => {
    if (!externalName) return;
    const controller = new AbortController();
    const p = new URLSearchParams({ end_day: String(end) });
    if (agent) p.set('agent_id', agent);
    if (day) {
      p.set('start_day', day);
      p.set('end_day', String(Math.min(Number(day), end)));
    }
    setLoading(true);
    setError('');
    fetch(`/api/experiments/${encodeURIComponent(externalName)}/time-stats?${p}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error('时间统计读取失败');
        return r.json();
      })
      .then((data) => {
        setRows(data.rows);
        setStorage(data.storage);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [externalName, agent, day, end, world.seq]);
  if (!externalName) return null;
  const totals = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.agentId}:${r.action}:${r.source}`;
    const t = totals.get(key) ?? { ...r, minutes: 0, starts: 0, completed: 0, failures: 0 };
    t.minutes += r.minutes;
    t.starts += r.starts;
    t.completed += r.completed;
    t.failures += r.failures;
    totals.set(key, t);
  }
  const data = [...totals.values()].sort((a, b) => b.minutes - a.minutes);
  const max = Math.max(1, ...data.map((r) => r.minutes));
  return (
    <section className="data-panel" aria-label="个体行动时间统计">
      <h3>个体行动时间</h3>
      <p className="muted">
        按动作开始日汇总分配分钟，包含进行中动作；旧版按 1 AP = 120 分钟换算。
        {historical ? `历史统计截至第 ${end} 个已完成日。` : ''}
      </p>
      <div className="filter-row">
        <select aria-label="时间统计居民" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">全部居民</option>
          {world.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} #{a.id}
            </option>
          ))}
        </select>
        <select aria-label="时间统计日期" value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="">全部日期</option>
          {Array.from({ length: end }, (_, i) => (
            <option key={i} value={i + 1}>
              第 {i + 1} 天
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p>读取中…</p>
      ) : storage === 'legacy-files' ? (
        <p>此档案尚未迁移到数据库。</p>
      ) : !data.length ? (
        <p>此范围尚无行动统计。</p>
      ) : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>居民</th>
                <th>动作</th>
                <th>来源</th>
                <th>分配分钟</th>
                <th>开始 / 完成 / 失败</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={`${r.agentId}:${r.action}:${r.source}`}>
                  <th>
                    {world.agents.find((a) => a.id === r.agentId)?.name} #{r.agentId}
                  </th>
                  <td>
                    {eventNames[r.action] ?? r.action}
                    {r.basic ? ' · 生存' : ''}
                  </td>
                  <td>
                    {{ rule: '规则', plan: '计划', llm: '模型', fallback: '降级', legacy: '旧版' }[
                      r.source
                    ] ?? r.source}
                  </td>
                  <td>
                    <meter min={0} max={max} value={r.minutes} /> {Math.round(r.minutes)}
                  </td>
                  <td>
                    {r.starts} / {r.completed} / {r.failures}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
