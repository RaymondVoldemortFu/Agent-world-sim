import ActionTimeStats from './ActionTimeStats';
import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { World } from '../sim/types';
import { BUILDINGS, RECIPES, CROPS } from '../ecology/catalog';
import { energy } from '../ecology/batches';
import { worldStatistics, number as n, goalNames } from './world-statistics';

function Trend({
  title,
  data,
  series,
  separateAxes = false,
}: {
  title: string;
  data: ReturnType<typeof worldStatistics>['chart'];
  series: [string, string, string][];
  separateAxes?: boolean;
}) {
  return (
    <section className="data-panel">
      <h3>{title}</h3>
      {data.length ? (
        <div className="stats-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#324237" strokeDasharray="3 6" />
              <XAxis dataKey="day" tick={{ fill: '#aab7a0' }} />
              <YAxis yAxisId="left" tick={{ fill: '#aab7a0' }} />
              {separateAxes && (
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#79b9bb' }} />
              )}
              <Tooltip
                contentStyle={{ background: '#19291f', borderColor: '#51654c' }}
                labelFormatter={(v) => `第 ${v} 天`}
              />
              <Legend />
              {series.map(([key, name, color], i) => (
                <Line
                  key={key}
                  dataKey={key}
                  yAxisId={separateAxes && i > 0 ? 'right' : 'left'}
                  name={separateAxes ? `${name}（${i > 0 ? '右轴' : '左轴'}）` : name}
                  stroke={color}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted">首个日结后显示趋势。</p>
      )}
    </section>
  );
}
export default function StatisticsPage({
  world: w,
  historical,
  externalName,
  onAgent,
}: {
  world?: World;
  historical: boolean;
  externalName?: string;
  onAgent: (id: number) => void;
}) {
  const s = useMemo(() => (w ? worldStatistics(w) : undefined), [w]);
  if (!w || !s)
    return (
      <section className="data-page">
        <h2>统计数据</h2>
        <p>生成或选择一份实验后查看世界状态。</p>
      </section>
    );
  const e = w.ecology;
  const value = (v: number | null) => (v === null ? '—' : n(v));
  const jobs = e?.jobs ?? [];
  return (
    <section className="data-page" aria-label="世界统计数据">
      <div className="data-heading">
        <div>
          <p className="eyebrow">WORLD STATISTICS</p>
          <h2>世界状态一览</h2>
          <p className="muted">
            {historical ? '历史回放' : '当前世界'} · 第 {w.tick} 天 · 已完成 {w.metrics.length}/
            {w.config.days} 天 · 事件 #{w.seq}
          </p>
        </div>
        {e && (
          <div className="data-season">
            {e.regionNames.length} 个区域 ·{' '}
            {{ spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[e.climate.season]}
            <small>
              {n(e.climate.temperature)} °C · 降雨 {n(e.climate.rain)} mm
            </small>
          </div>
        )}
      </div>
      <div className="data-cards">
        {[
          [
            '存活人口',
            `${s.alive.length} 人`,
            `出生 ${w.counters.births} · 死亡 ${w.counters.deaths}`,
          ],
          ['平均生命', value(s.averageHP), `生命低于35：${s.critical} 人`],
          ['平均饱食度', value(s.averageHunger), `饱食度≤40：${s.hungry} 人`],
          [
            '平均孤单',
            value(s.averageLoneliness),
            `抑郁 ${s.depressed} 人 · 妊娠 ${s.pregnancies} 人`,
          ],
          [
            '已采食物库存',
            `${n(s.current.food)} ${e ? 'FD' : '份'}`,
            e ? `风险≥0.5：${n(s.riskyFD)} FD` : `腐败 ${n(s.current.spoiledFood ?? 0)} 份`,
          ],
          ['野生食物现存量', `${n(s.current.wildFood)} ${e ? 'FD' : '份'}`, '未采集库存'],
          [
            '累计交流',
            `${w.counters.chats} 次`,
            `赠予 / 照料 ${w.counters.gifts} · 攻击 ${w.counters.attacks}`,
          ],
          [
            '模型请求',
            `${n(w.usage.calls)} 次`,
            `Token ${n(w.usage.inputTokens + w.usage.outputTokens)}`,
          ],
        ].map(([label, v, note]) => (
          <article className="data-card" key={label}>
            <span>{label}</span>
            <strong>{v}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <p className="muted">
        {e
          ? '1 FD = 2,500 kcal。食物库存包含活人背包、地面与仓储，按剩余质量修正；不含体内能量和在制投入。风险食物包含在总库存中，野生存量不代表每日产出。'
          : '食物以旧版物品份数统计。'}{' '}
        健康均值仅计算活人；趋势图为每日结束时的记录。
      </p>
      <div className="data-grid">
        <Trend title="人口变化" data={s.chart} series={[['alive', '存活人数', '#c2d48a']]} />
        <Trend
          title="饱食与孤单"
          data={s.chart}
          series={[
            ['avgHunger', '平均饱食', '#c2d48a'],
            ['avgLoneliness', '平均孤单', '#dca976'],
          ]}
        />
        <Trend
          title={`食物库存（${e ? 'FD' : '份'}）`}
          separateAxes
          data={s.chart}
          series={[
            ['food', '已采食物', '#c2d48a'],
            ['wildFood', '野生存量', '#79b9bb'],
          ]}
        />
        <Trend
          title="每日交流与模型请求"
          data={s.chart}
          series={[
            ['dailyChats', '当日交流', '#c2d48a'],
            ['dailyCalls', '当日请求', '#dca976'],
          ]}
        />
      </div>
      {e && (
        <>
          <section className="data-panel">
            <h3>区域与产业</h3>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>区域</th>
                    <th>活人</th>
                    <th>地面 / 仓储食物 FD</th>
                    <th>田块 / 面积 ha</th>
                    <th>已建成 / 建造中</th>
                  </tr>
                </thead>
                <tbody>
                  {e.regionNames.map((name, r) => {
                    const tiles = w.tiles.filter((t) => t.eco!.region === r);
                    const fields = tiles.flatMap((t) => t.eco!.fields);
                    const buildings = tiles.flatMap((t) => t.eco!.structures);
                    const done = buildings.filter(
                      (b) => b.progress >= BUILDINGS[b.kind].minutes,
                    ).length;
                    return (
                      <tr key={name}>
                        <th>{name}</th>
                        <td>{s.alive.filter((a) => a.eco!.region === r).length}</td>
                        <td>
                          {n(
                            energy(
                              tiles.flatMap((t) => [
                                ...t.eco!.ground,
                                ...t.eco!.structures.flatMap((b) => b.contents),
                              ]),
                            ) / 2500,
                          )}
                        </td>
                        <td>
                          {fields.length} / {n(fields.reduce((v, f) => v + f.area, 0))}
                        </td>
                        <td>
                          {done} / {buildings.length - done}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="data-chips">
              <span>工序启动 {jobs.length}</span>
              <span>
                进行中 {jobs.filter((j) => !['complete', 'cancelled'].includes(j.state)).length}
              </span>
              <span>完成 {jobs.filter((j) => j.state === 'complete').length}</span>
              <span>取消 {jobs.filter((j) => j.state === 'cancelled').length}</span>
              <span>多人参与 {jobs.filter((j) => j.operators.length > 1).length}</span>
              <span>成熟田块 {s.fields.filter((f) => f.stage === 'ripe').length}</span>
              <span>
                畜群{' '}
                {n(
                  w.tiles.reduce(
                    (sum, t) => sum + t.eco!.herds.reduce((v, h) => v + h.count, 0),
                    0,
                  ),
                )}{' '}
                只
              </span>
            </div>
            <details>
              <summary>工艺与作物分布</summary>
              <div className="data-chips">
                {[...new Set(jobs.map((j) => j.recipe))].map((id) => (
                  <span key={id}>
                    {RECIPES[id]?.name ?? id}：
                    {jobs.filter((j) => j.recipe === id && j.state === 'complete').length}/
                    {jobs.filter((j) => j.recipe === id).length} 完成
                  </span>
                ))}
                {[...new Set(s.fields.map((f) => f.crop ?? '备地'))].map((id) => (
                  <span key={id}>
                    {CROPS[id]?.name ?? id}：
                    {s.fields.filter((f) => (f.crop ?? '备地') === id).length} 块
                  </span>
                ))}
              </div>
            </details>
          </section>
          <section className="data-panel">
            <h3>
              资源库存 <small>kg</small>
            </h3>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>资源</th>
                    <th>自然存量 / 矿藏</th>
                    <th>活人背包</th>
                    <th>地面</th>
                    <th>仓储</th>
                    <th>在制投入</th>
                  </tr>
                </thead>
                <tbody>
                  {s.resources.map((r) => (
                    <tr key={r.id}>
                      <th>{r.name}</th>
                      {(['natural', 'bag', 'ground', 'stored', 'processing'] as const).map((k) => (
                        <td key={k}>{n(r[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <ActionTimeStats world={w} externalName={externalName} historical={historical} />
      <section className="data-panel">
        <h3>运行与模型消耗</h3>
        <div className="stats-list">
          {Object.entries({
            输入Token: n(w.usage.inputTokens),
            输入缓存命中率: w.usage.inputTokens
              ? `${((100 * w.usage.cachedTokens) / w.usage.inputTokens).toFixed(1)}%`
              : '—',
            上下文压缩次数: w.usage.contextCompressions ?? 0,
            '压缩输入 / 输出Token': `${n(w.usage.compressionInputTokens ?? 0)} / ${n(w.usage.compressionOutputTokens ?? 0)}`,
            输出Token: n(w.usage.outputTokens),
            '缓存命中Token（包含在输入中）': n(w.usage.cachedTokens),
            模型错误: w.usage.errors,
            格式修复: w.usage.repairs,
            无效动作: w.counters.failures,
            知识发现: w.counters.discoveries,
            估算费用:
              w.config.inputPrice || w.config.outputPrice || w.config.cachePrice
                ? w.usage.cost.toFixed(4)
                : '未配置单价',
            ...(e
              ? {
                  规则执行: e.brainStats.ruleActions,
                  持续计划: e.brainStats.planActions,
                  模型决策: e.brainStats.llmDecisions,
                  降级执行: e.brainStats.fallbacks,
                }
              : {}),
          }).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        {w.usage.estimated && <p className="muted">部分 Token 用量为估算值。</p>}
      </section>
      <section className="data-panel">
        <h3>
          居民状态 <small>点击居民查看经历</small>
        </h3>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>居民</th>
                <th>状态</th>
                <th>位置</th>
                <th>生命 / 饱食 / 孤单</th>
                <th>当前目标</th>
                <th>今日 / 累计模型请求</th>
              </tr>
            </thead>
            <tbody>
              {w.agents.map((a) => (
                <tr key={a.id}>
                  <th>
                    <button className="text-button" onClick={() => onAgent(a.id)}>
                      {a.name} #{a.id}
                    </button>
                  </th>
                  <td>
                    {a.death ? `第${a.death.day}天死亡` : a.social?.depressed ? '抑郁' : '存活'}
                  </td>
                  <td>
                    {e ? `${e.regionNames[a.eco!.region]} ` : ''}({a.x},{a.y})
                  </td>
                  <td>
                    {n(a.hp)} / {n(a.hunger)} / {n(a.social?.loneliness ?? 0)}
                  </td>
                  <td>
                    {a.death ? '—' : a.brain?.goal ? goalNames[a.brain.goal.skill] : '暂无目标'}
                  </td>
                  <td>{a.brain ? `${a.brain.callsDay} / ${a.brain.calls}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
