import { continuousConfig, type ContinuousConfig } from './config';
import { body, DAY, type World } from './types';

export function ContinuousFields({
  value,
  onChange,
  mode,
  onMode,
}: {
  value: ContinuousConfig;
  onChange: (v: ContinuousConfig) => void;
  mode: 'llm' | 'scripted';
  onMode: (v: 'llm' | 'scripted') => void;
}) {
  return (
    <div className="settings-grid">
      <p>榆树村 · 5人 · 18×16格 · 游戏一天固定为现实120秒。已有实验保持原配置。</p>
      <label>
        运行模式
        <select
          aria-label="运行模式"
          value={mode}
          onChange={(e) => onMode(e.target.value as typeof mode)}
        >
          <option value="llm">LLM 自主演化</option>
          <option value="scripted">脚本演示</option>
        </select>
      </label>
      {(
        [
          ['days', '实验天数', 1, 1000, 1],
          ['maxCalls', '规划请求上限', 0, 100000, 1],
          ['concurrency', '连续模式并发上限', 1, 8, 1],
          ['contextWindow', '上下文窗口（token）', 4000, 128000, 1000],
          ['inventoryCapacity', '背包容量（kg）', 5, 100, 1],
        ] as const
      ).map(([key, label, min, max, step]) => (
        <label key={key}>
          {label}
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <p>
        上下文约达到窗口的85%时压缩活动历史，固定规则和人格保留；模型不设置输出截断上限。压缩也会产生模型用量。
      </p>
    </div>
  );
}

export default function ContinuousConfigPanel({
  world,
  model,
  onCreate,
}: {
  world?: World;
  model?: string;
  onCreate: () => void;
}) {
  const c = continuousConfig(world);
  return (
    <section className="data-page" aria-label="连续世界配置">
      <div className="data-heading">
        <div>
          <p className="eyebrow">WORLD CONFIGURATION</p>
          <h2>连续世界配置</h2>
          <p className="muted">
            {world ? '当前实验实际保存的配置' : '下一次实验的默认配置'} · 榆树村
          </p>
        </div>
        <button onClick={onCreate}>配置下一次实验</button>
      </div>
      <div className="data-panel">
        <dl className="continuous-config-grid">
          {Object.entries({
            执行模式: '连续动作 / 异步计划',
            时间比例: '游戏1天 = 现实2分钟',
            实验天数: `${c.days}天（约${((c.days * 2) / 60).toFixed(1)}小时，暂停除外）`,
            地图与人口: '18×16格 · 15米/格 · 5人',
            控制器: world?.mode === 'scripted' ? '脚本演示' : 'LLM 自主',
            模型: model ?? '使用已配置供应商',
            背包容量: `${c.inventoryCapacity} kg`,
            规划请求上限: `${c.maxCalls}次`,
            请求并发上限: `${c.concurrency}（每人最多1个在途）`,
            上下文窗口: `${c.contextWindow.toLocaleString()} tokens`,
            思考间隔: '通常每半个游戏日一次',
            日程初始值:
              world?.mode === 'scripted'
                ? '演示安排：自动吃饭、补粮与指定农活'
                : '仅自动进食，其他任务由Agent自行配置',
            '进食 / 消耗': '吃随身粮食 · 2500 kcal/人日',
            农业周期: '30天成熟 · 第40天后产量减半',
            存储: 'MySQL 事件与轨迹 · 定期快照',
          }).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="muted">
        连续原型的王税、使者、战斗和铭文尚未接入。切换执行模式会创建独立实验，不会将原有存档转换为另一种规则。
      </p>
    </section>
  );
}

export function ContinuousStatistics({ world: w }: { world?: World }) {
  if (!w)
    return (
      <section className="data-page">
        <h2>统计数据</h2>
        <p>选择连续实验后查看。</p>
      </section>
    );
  return (
    <section className="data-page">
      <div className="data-heading">
        <h2>连续村庄统计</h2>
        <span>
          第{Math.floor(w.time / DAY) + 1}天 · 已提交 #{w.seq}
        </span>
      </div>
      <div className="data-panel data-table">
        <table>
          <thead>
            <tr>
              <th>居民</th>
              <th>生命</th>
              <th>饱食度</th>
              <th>随身口粮 kg</th>
              <th>劳动小时</th>
              <th>发言</th>
              <th>思考 / tokens</th>
            </tr>
          </thead>
          <tbody>
            {w.agents.map((a) => {
              const b = body(a, w.time);
              return (
                <tr key={a.id}>
                  <th>
                    {a.name} #{a.id}
                  </th>
                  <td>{b.hp.toFixed(1)}</td>
                  <td>{(b.food / 50).toFixed(1)}</td>
                  <td>{a.grain.toFixed(2)}</td>
                  <td>{(a.stats.workMs / 3600000).toFixed(1)}</td>
                  <td>{a.stats.spoken}</td>
                  <td>
                    {a.thoughts} / {a.tokens}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="data-panel">
        <h3>实际储粮</h3>
        {w.stores.map((s) => (
          <p key={s.id}>
            {s.label}：{s.grain.toFixed(2)} kg，装取预留 {s.reserved.toFixed(2)} kg
          </p>
        ))}
      </div>
    </section>
  );
}
