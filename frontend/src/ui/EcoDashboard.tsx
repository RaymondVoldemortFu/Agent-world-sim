import { useState } from 'react';
import { combatPolicy, fleeProbability } from '../ecology/combat-policy';
import EcoMap from './EcoMap';
import type { World } from '../sim/types';
import { ITEMS, RECIPES, BUILDINGS, CROPS } from '../ecology/catalog';
import { BEAST_NAMES, settlements, combatView } from '../ecology/wildlife';
import { mass, energy } from '../ecology/batches';
const colors = {
  forest: '#355c47',
  meadow: '#829154',
  wetland: '#527f79',
  floodplain: '#9b985a',
  hill: '#806e58',
  water: '#3d718c',
};
const names = {
  forest: '林地',
  meadow: '草甸',
  wetland: '湿地',
  floodplain: '河漫滩',
  hill: '丘陵',
  water: '水域',
};
const seasons = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
export default function EcoDashboard({ world: w, layer }: { world: World; layer?: string }) {
  const [region, setRegion] = useState(0),
    [pos, setPos] = useState<[number, number]>([0, 0]),
    [person, setPerson] = useState(1),
    [catalog, setCatalog] = useState(false);
  const e = w.ecology!,
    t = w.tiles.find((t) => t.x === pos[0] && t.y === pos[1] && t.eco!.region === region)!,
    a = w.agents.find((a) => a.id === person);
  const number = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  return (
    <section className="eco-dashboard">
      <div className="panel-toolbar">
        <strong>
          生态与产业 · 第 {e.climate.year} 年 · {seasons[e.climate.season]} · 年内第 {e.climate.day}{' '}
          天
        </strong>
        <span>
          {number(e.climate.temperature)} °C · 雨量 {number(e.climate.rain)} mm · {e.clock} /{' '}
          {w.config.dailyAP * 120} 分钟
        </span>
      </div>
      <div className="eco-stats">
        {e.village && (
          <span>
            初始村落 ({e.village.x},{e.village.y}) · 农田 {number(e.village.farmlandHa)} ha
          </span>
        )}
        <span>规则执行 {e.brainStats.ruleActions}</span>
        <span>持续计划 {e.brainStats.planActions}</span>
        <span>模型决策 {e.brainStats.llmDecisions}</span>
        <span>降级 {e.brainStats.fallbacks}</span>
        <span>
          野兽 {(e.beasts ?? []).filter((b) => b.hp > 0).length} · 聚居地 {settlements(w).length}
        </span>
        <span>
          请求 {w.usage.calls} · Token {number(w.usage.inputTokens + w.usage.outputTokens)}
        </span>
      </div>
      <div className="eco-grid">
        <div>
          <div className="segmented">
            {e.regionNames.map((name, i) => (
              <button
                key={name}
                className={region === i ? 'active' : ''}
                onClick={() => setRegion(i)}
              >
                {name}
              </button>
            ))}
          </div>
          <EcoMap
            world={w}
            layer={layer}
            region={region}
            selected={pos}
            onSelect={(p) => {
              setPos(p);
              const a = w.agents.find(
                (a) => !a.death && a.eco!.region === region && a.x === p[0] && a.y === p[1],
              );
              if (a) setPerson(a.id);
            }}
          />
          <p className="muted">
            {Object.entries(names).map(([k, v]) => (
              <span key={k} style={{ color: colors[k as keyof typeof colors], marginRight: 12 }}>
                ■ {v}
              </span>
            ))}
          </p>
          <p>
            每格 6.25
            ha；人物标记为活人，金色为先知，交叉记号为尸体；红棕兽首为野兽，虚线框为聚居地，实线围框为城墙，小板标记为铭文。
          </p>
        </div>
        <div className="eco-detail">
          <h3>
            {e.regionNames[region]} ({pos.join(', ')}) · {names[t.eco!.biome]}
          </h3>
          {(e.beasts ?? [])
            .filter((b) => b.region === region && b.x === pos[0] && b.y === pos[1])
            .map((b) => (
              <p key={b.id}>
                {BEAST_NAMES[b.species]} {b.id} ·{' '}
                {b.hp > 0
                  ? `生命 ${b.hp}/${b.maxHp} · 攻击 ${b.attack} · ${b.mode === 'raiding' ? '袭扰聚居地' : '荒野游荡'}`
                  : '已死亡'}
              </p>
            ))}
          <p>
            土壤水 {number(t.eco!.soilWater)} mm · 氮 {number(t.eco!.nitrogen)} kg · 有机质{' '}
            {number(t.eco!.organic)}%
          </p>
          <p>
            自然存量：
            {Object.entries(t.eco!.biomass)
              .map(([k, n]) => `${ITEMS[k]?.name ?? k} ${number(n)} kg`)
              .join('；')}
          </p>
          <p>
            地面：
            {t.eco!.ground.map((b) => `${ITEMS[b.item]?.name} ${number(b.kg)} kg`).join('；') ||
              '无'}
          </p>
          {[...t.eco!.ground, ...t.eco!.structures.flatMap((s) => s.contents)]
            .filter((b) => b.inscription)
            .map((b) => (
              <article className="memory" key={b.id}>
                <strong>
                  {ITEMS[b.item]?.name} · {b.inscription!.id}
                </strong>
                <small>
                  第 {b.inscription!.day} 天 · {b.inscription!.authorName} #
                  {b.inscription!.authorId} 刻写
                </small>
                <p>{b.inscription!.text}</p>
              </article>
            ))}
          <p>
            矿藏：
            {t.eco!.deposits.map((d) => `${ITEMS[d.item]?.name} ${number(d.kg)} kg`).join('；')}
          </p>
          {t.eco!.fields.map((f) => (
            <p key={f.id}>
              {f.id} · {f.area} ha · {f.crop ?? '备地'} · {f.stage} · 积温 {number(f.gdd)} · 待收{' '}
              {number(f.harvestKg)} kg
            </p>
          ))}
          {t.eco!.structures.map((s) => (
            <p key={s.id}>
              {BUILDINGS[s.kind].name} · 劳动 {number(s.progress)}/{BUILDINGS[s.kind].minutes} min ·
              状况 {number(s.condition * 100)}%{' '}
              {BUILDINGS[s.kind].wall
                ? `· 城墙耐久 ${number(s.condition * BUILDINGS[s.kind].wall!.durability)}/${BUILDINGS[s.kind].wall!.durability}`
                : ''}{' '}
              · 库存 {number(mass(s.contents))}/{BUILDINGS[s.kind].storage} kg
            </p>
          ))}
          {t.eco!.herds.map((h) => (
            <p key={h.id}>
              {h.species} {h.count} 只 · 健康 {h.health}
            </p>
          ))}
          <select
            aria-label="生态居民"
            value={person}
            onChange={(ev) => setPerson(Number(ev.target.value))}
          >
            {w.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} #{a.id} {a.death ? '已死亡' : ''}
              </option>
            ))}
          </select>
          {a && (
            <>
              <h3>
                {a.name} #{a.id} {a.role === 'prophet' ? '先知' : ''} ·{' '}
                {a.sex === 'F' ? '女' : '男'} · {Math.floor(a.age / 365)} 岁
              </h3>
              <p>
                生命 {number(a.hp)} · 饱食 {number(a.hunger)} · AP {number(a.ap)} · 孤单{' '}
                {a.social?.loneliness}
                {a.social?.depressed ? ' / 抑郁' : ''}
              </p>
              <p>
                移动约束：
                {(a.brain?.movement?.holdUntil ?? 0) >
                (w.tick - 1) * w.config.dailyAP * 120 + e.clock
                  ? `原地停留剩余 ${number(a.brain!.movement!.holdUntil! - ((w.tick - 1) * w.config.dailyAP * 120 + e.clock))} 劳动分钟`
                  : '自由移动'}{' '}
                · 采集后{a.brain?.movement?.returnAfterGather ? '返回出发地' : '不自动返程'}
                {a.brain?.forageTrip?.returning ? ' · 正在返程' : ''}
              </p>
              <p>
                战斗策略：
                {
                  { flee: '遇战就逃', low_hp: '低血量撤退', fight: '死战到底' }[
                    combatPolicy(a.brain).mode
                  ]
                }
                {combatPolicy(a.brain).mode === 'low_hp'
                  ? `（生命 ≤ ${combatPolicy(a.brain).retreatHp}）`
                  : ''}
                {a.death
                  ? ''
                  : ` · 当前撤退成功率 ${Math.round(fleeProbability(a.hp) * 100)}%（须有安全路线）`}
              </p>
              {a.brain?.deepReflection && (
                <p>
                  第 {a.brain.deepReflection.day} 天深度反思：{a.brain.deepReflection.summary}
                  <br />
                  未来规划：{a.brain.deepReflection.plan}
                </p>
              )}
              {a.brain?.navigation && (
                <p>
                  坐标导航：
                  {a.brain.navigation.status === 'arrived'
                    ? '已到达'
                    : a.brain.navigation.status === 'blocked'
                      ? a.brain.navigation.reason
                      : `前往 (${a.brain.goal?.x},${a.brain.goal?.y}) · 规划剩余 ${a.brain.navigation.steps} 步`}
                </p>
              )}
              <p>
                区域 {a.eco!.region} ({a.x},{a.y}) · 水 {number(a.eco!.waterL)} L · 体内能量{' '}
                {number(a.eco!.foodKcal)} kcal
              </p>
              <p>
                背包 {number(mass(a.eco!.stock))} kg / 食物 {number(energy(a.eco!.stock) / 2500)}{' '}
                FD：
                {a
                  .eco!.stock.map(
                    (b) => `${ITEMS[b.item]?.name} ${number(b.kg)} kg (风险${number(b.risk)})`,
                  )
                  .join('；')}
              </p>
              <p>
                战斗：{combatView(a).attack} 攻击 · 减伤 {number(combatView(a).protection * 100)}% ·
                武器 {ITEMS[combatView(a).weapon]?.name ?? '徒手'} · 护甲{' '}
                {ITEMS[combatView(a).armor]?.name ?? '无'} · 盾{' '}
                {ITEMS[combatView(a).shield]?.name ?? '无'}
              </p>
              <p>
                决策来源 {a.brain!.source} · 今日模型请求 {a.brain!.callsDay}/
                {w.config.llmDailyCalls}
              </p>
              <p>
                持续计划：{a.brain!.goal ? JSON.stringify(a.brain!.goal) : '无'} ·{' '}
                {a.brain!.thought}
              </p>
              {a.brain!.lastFailure && <p role="status">任务受阻：{a.brain!.lastFailure}</p>}
              <details>
                <summary>认知与技能</summary>
                <p>{a.eco!.knowledge.join('、')}</p>
                <pre>{JSON.stringify(a.eco!.skills, null, 2)}</pre>
                {a.memories
                  .slice(-8)
                  .reverse()
                  .map((m) => (
                    <p key={m.id}>
                      第{m.day}天 / {m.source}：{m.content}
                    </p>
                  ))}
              </details>
            </>
          )}
        </div>
      </div>
      <details>
        <summary>工序任务（{e.jobs.length}）与资源账</summary>
        <div className="eco-table">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>地点</th>
                <th>状态</th>
                <th>劳动 / 分钟</th>
                <th>最早完成日</th>
                <th>参与者</th>
              </tr>
            </thead>
            <tbody>
              {e.jobs
                .slice(-100)
                .reverse()
                .map((j) => (
                  <tr key={j.id}>
                    <td>
                      {j.id} {RECIPES[j.recipe].name}
                    </td>
                    <td>
                      {j.region}: {j.x},{j.y}
                    </td>
                    <td>{j.state}</td>
                    <td>
                      {number(j.work)}/{RECIPES[j.recipe].minutes}
                    </td>
                    <td>{j.readyDay}</td>
                    <td>{j.operators.join(', ')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p>
          采集 {number(e.ledger.gatheredKg)} kg · 收割 {number(e.ledger.harvestedKg)} kg · 消费{' '}
          {number(e.ledger.consumedKcal)} kcal · 储存损耗 {number(e.ledger.spoiledKg)} kg · 工序产出{' '}
          {number(e.ledger.outputKg)} kg
        </p>
      </details>
      <button onClick={() => setCatalog(!catalog)}>
        资源 / 合成 / 建筑目录 {catalog ? '收起' : '展开'}
      </button>
      {catalog && (
        <div className="eco-table">
          <p>
            {Object.keys(ITEMS).length} 类物品 · {Object.keys(RECIPES).length} 条工艺 ·{' '}
            {Object.keys(BUILDINGS).length} 种建筑 · {Object.keys(CROPS).length} 类作物
          </p>
          <table>
            <thead>
              <tr>
                <th>工艺</th>
                <th>投入 kg</th>
                <th>产出 kg</th>
                <th>劳动 / 等待</th>
                <th>设备 / 工具</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(RECIPES).map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} ({r.id})
                  </td>
                  <td>
                    {Object.entries(r.inputs)
                      .map(([k, n]) => `${ITEMS[k].name} ${n}`)
                      .join('；')}
                  </td>
                  <td>
                    {Object.entries(r.outputs)
                      .map(([k, n]) => `${ITEMS[k].name} ${n}`)
                      .join('；')}
                  </td>
                  <td>
                    {r.minutes} min / {r.days} 天
                  </td>
                  <td>
                    {r.facility ?? '—'} / {r.capability ?? '徒手'}
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
