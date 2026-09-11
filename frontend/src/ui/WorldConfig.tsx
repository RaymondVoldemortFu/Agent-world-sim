import { CRAFTS } from '../manor/catalog';
import { ITEMS } from '../ecology/catalog';
import { MANOR_DEFAULTS } from '../manor/world';
import type { Config, World } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/types';
import { RULES_VERSION, SHOUT_AP, SHOUT_RADIUS } from '../sim/world';

export default function WorldConfig({
  world,
  draft,
  model,
  contextWindow,
  onCreate,
}: {
  world?: World;
  draft: Config;
  model: string;
  contextWindow?: number;
  onCreate: () => void;
}) {
  const automatic =
    !world ||
    ['mvp-1.3.0', 'mvp-1.4.0', 'mvp-1.5.0', 'mvp-1.6.0', 'mvp-1.7.0'].includes(world.rulesVersion);
  const social =
    !world || ['mvp-1.4.0', 'mvp-1.5.0', 'mvp-1.6.0', 'mvp-1.7.0'].includes(world.rulesVersion);
  const destructiveDrop =
    !world || ['mvp-1.5.0', 'mvp-1.6.0', 'mvp-1.7.0'].includes(world.rulesVersion);
  const fullPerception = !world || ['mvp-1.6.0', 'mvp-1.7.0'].includes(world.rulesVersion);
  const legacy = world?.rulesVersion === 'mvp-1.0.0';
  const config = world ? { ...DEFAULT_CONFIG, ...world.config } : draft;
  const effectiveWindow =
    (world ? world.config.contextWindow : draft.contextWindow) ?? contextWindow;
  const spawnLabel = {
    compact: '扎堆出现（同一区域 2×2 四格）',
    clusters: '分区随机',
    uniform: '全图均匀随机',
  }[config.spawn];
  if (config.ecoPreset === 'manor') {
    const m = { ...MANOR_DEFAULTS, ...config.manorSettings };
    return (
      <section className="eco-dashboard">
        <h2>鸦溪领地 · 实验配置</h2>
        <p>24×24 格 · 每格约15米的建筑/田条入口尺度 · 31名初始居民 · 6户家庭 · 48条田</p>
        <p>
          每30天收成一次；实际产量随已投入劳动变化。潜在月产1800人日粮，每人每日约0.7353kg谷物。
        </p>
        <table>
          <tbody>
            {[
              ['地租惯例', `${m.taxRate * 100}%（由实际交付实现）`],
              ['固定王税', `${m.royalTax} 人日粮 / 期；首次D35`],
              ['作物灾害', m.shockDay ? `D${m.shockDay}起，产量倍率${m.yieldMultiplier}` : '关闭'],
              ['拖欠时间限制', `${m.graceDays} 天`],
              ['王军镇压条件', `连续欠税超过 ${2 * m.graceDays} 天，或使者返回报告叛乱；无宽限`],
              ['王军人数', `${m.armySize}`],
              ['王军行动', '无差别追击居民、破门攻击；王室供应军粮'],
              ['日劳动', `${config.dailyAP} AP × 120分钟`],
              ['背包', `${config.inventoryCapacity}kg`],
              ['模型', model],
              ['上下文窗口', `${effectiveWindow ?? 100000} tokens`],
              [
                '模型预算',
                `${config.llmDailyCalls} 次/人/天；${config.llmDailyTokens} tokens/人/天`,
              ],
              ['实验时长', `${config.days} 天`],
            ].map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          日常取粮、固定田劳动和回家存粮由规则执行；身份、忠诚和交税决定来自个人上下文与自主决策。地图外国王执行实收税账和出兵规则。
        </p>
        <details>
          <summary>工棚合成表</summary>
          <table>
            <thead>
              <tr>
                <th>配方</th>
                <th>投入</th>
                <th>产物</th>
                <th>分钟</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(CRAFTS).map(([id, r]) => (
                <tr key={id}>
                  <th>{ITEMS[id]?.name ?? id}</th>
                  <td>
                    {Object.entries(r.inputs)
                      .map(([i, n]) => `${ITEMS[i]?.name ?? i} ${n}kg`)
                      .join('、')}
                  </td>
                  <td>
                    {Object.entries(r.outputs)
                      .map(([i, n]) => `${ITEMS[i]?.name ?? i} ${n}kg`)
                      .join('、')}
                  </td>
                  <td>{r.minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <button onClick={onCreate}>配置下一次实验</button>
      </section>
    );
  }
  if (config.worldModel === 'ecology')
    return (
      <section className="eco-dashboard">
        <h2>生态与混合决策配置</h2>
        <p>
          {config.size} × {config.size} 格 / 区域 · {config.regions} 个区域 · 每格 6.25 ha · 365 天
          / 年
        </p>
        <p>
          开局{' '}
          {
            { forager: '采集者', settlement: '农业定居', village: '初始村落', manor: '中世纪领地' }[
              config.ecoPreset
            ]
          }{' '}
          · 第 {config.startDay} 年内日 · {config.population} 人 · {config.days} 天
        </p>
        <p>出生分布：{spawnLabel}</p>
        {config.ecoPreset === 'village' && (
          <p>
            初始村落：河谷 2×2 格集中居住；农田 {(config.population * 0.35).toFixed(2)} ha， 45
            天口粮与下一季种粮，共有住宅、粮仓、工棚、农具、水井和羊群。
            作物按开局季节处于生长或待播状态；初始默认采食后返程，Agent 可自行修改。
          </p>
        )}
        <p>
          野兽：{config.wildlifeEnabled ? '开启' : '关闭'} · 一格内至少 5 人或 3
          处已建建筑／已备农田形成聚居地；野兽在 3–5 格外出现，每区最多 3 只／群，每 5
          天检查补充；同区野兽死亡后冷却 {config.beastRespawnDays ?? 10} 天。
        </p>
        <p>
          野兽战斗力倍率 {config.beastPowerMultiplier ?? 1}×：生命{' '}
          {Math.round(180 * (config.beastPowerMultiplier ?? 1))}–
          {Math.round(260 * (config.beastPowerMultiplier ?? 1))}，攻击{' '}
          {Math.round(24 * (config.beastPowerMultiplier ?? 1))}–
          {Math.round(36 * (config.beastPowerMultiplier ?? 1))}
          ，每日移动一格；武器、防具须完整且随身携带。先知外向性固定 0.85。
        </p>
        <p>
          战斗策略由居民自行选择：遇战就逃（默认）／低血量撤退（默认阈值
          60）／死战到底。自动战斗逐轮检查，紧急撤退优先于停留约束；每轮最多尝试一次，成功率为 10% +
          80% × 血量比例；两步内没有安全陆路时无法脱身。
        </p>
        <p>
          日劳动 {config.dailyAP} AP（每 AP 120 分钟）· 基础负重 {config.inventoryCapacity} kg ·
          每人每日最多 {config.llmDailyCalls} 次请求 / {config.llmDailyTokens} token
        </p>
        {effectiveWindow && (
          <p>
            {world ? '本实验' : '下一次实验'}上下文窗口 {effectiveWindow.toLocaleString()} tokens ·
            预留输出后约 90% 时压缩活动历史，固定规则与知识目录保留。
          </p>
        )}
        <p>
          规则执行生存和持续计划；模型负责社交与复杂目标。普通说话 / 公开发言 24
          分钟，公开发言面向同一区域一格内所有活人。大声说话 / 全力观察 240 分钟。
        </p>
        <p>
          Agent
          可指定采集物品和数量、选择采集后返程，并设置定点停留的劳动分钟数；停留期间可原地生产与交流，到期或主动取消后恢复移动。
        </p>
        <p>
          食物按重量、热量、水分与风险保存；温度和储藏设施影响损耗。种植受播种窗口、种子、积温、土壤和劳动约束。矿藏有限，森林慢速更新。
        </p>
        <p>
          城墙四级：木栅墙 / 夯土围墙 / 干砌石墙 / 加固石墙，完工后保护同格营地，可修缮。木板刻字 60
          分钟，石板刻字 120 分钟；铭文保存在实物与阅读者记忆中。
        </p>
        <p>成年 16 年 · 妊娠 280 天 · 明确接受后成功交配受孕率 100% · 产后冷却 180 天</p>
        <p>
          全局调用预算 {config.maxCalls} · Token 预算 {config.maxTokens} · 模型 {model}
        </p>
        <button onClick={onCreate}>配置新实验</button>
        <details>
          <summary>完整参数</summary>
          <pre>{JSON.stringify(config, null, 2)}</pre>
        </details>
      </section>
    );
  const spoiledGain = world
    ? (world.config.spoiledFoodHungerGain ?? 0)
    : config.spoiledFoodHungerGain;
  const dailyAP = world ? world.config.dailyAP : config.dailyAP;
  const freeDrop = world ? (world.config.freeDrop ?? false) : config.freeDrop;
  const sections: { title: string; rows: [string, string | number][] }[] = [
    {
      title: '地图与实验',
      rows: [
        ['地图尺寸', `${config.size} × ${config.size}`],
        ['初始居民', `${config.population} 人`],
        [
          '先知',
          world
            ? `${world.agents.filter((a) => a.role === 'prophet').length} 人（初始掌握全部配方）`
            : '1 人（包含在初始居民中，掌握全部配方）',
        ],
        ['实验周期', `${config.days} 天`],
        ['世界种子', config.seed],
        ['初始分布', spawnLabel],
        ['观察范围', '以本人为中心的九宫格'],
        ['全力观察', fullPerception ? '2 AP，3 格内（含斜向），保存当时环境快照' : '此版本未提供'],
        ['尸体', fullPerception ? '死亡后保留在原地，可观察，不是交流对象' : '此版本未提供'],
        ['观察方式', automatic ? '每次决策自动更新，0 AP' : '决策附带视野，look 动作另耗 1 AP'],
        ['普通说话', '1 AP，周围九宫格可听见'],
        ['公开发言', '1 AP，周围九宫格内所有活人同时听见'],
        [
          '大声说话',
          automatic ? `${SHOUT_AP} AP，${SHOUT_RADIUS} 格内可听见（含斜向）` : '此版本未提供',
        ],
      ],
    },
    {
      title: '食物与资源',
      rows: [
        ['未改造平原食物上限', `${legacy ? 6 : config.plainFoodCapacity} 份 / 格`],
        ['平原采集恢复等待', `${legacy ? 2 : config.plainRecoveryDays} 天`],
        ['平原恢复速度', '每天 1 份，达到上限后停止'],
        ['丘陵食物上限', '3 份 / 格'],
        ['野生采集 / 农田收获', '每次最多 2 / 4 份'],
        ['成熟农田', '每天产 3 份，待收上限 12 份'],
        ['采后保鲜期', legacy ? '长期保存' : `${config.foodShelfLifeDays} 天`],
        [
          '腐败食物影响',
          legacy
            ? '食物长期保存'
            : `每份扣 ${config.spoiledFoodDamage} 点生命，饱食度 +${spoiledGain}`,
        ],
        ['新鲜食物影响', '每份饱食度 +20'],
        ['库存食物取用', legacy ? '按数量取用' : '进食优先新鲜；转移优先最早到期'],
      ],
    },
    {
      title: '生命与繁衍',
      rows: [
        ['成功交配受孕率', '100%'],
        ['妊娠期', `${config.gestation} 天`],
        ['成年年龄', `${config.adultAge} 天`],
        ['产后冷却', '10 天'],
        ['共同繁衍条件', '成年异性、同格、双方饱食度 ≥60；先协商，再于同一天各执行共同动作'],
        ['每日行动点', dailyAP === undefined ? '成年 3 / 幼年 1' : `${dailyAP} AP / 人（含幼年）`],
        [
          '丢弃物品',
          destructiveDrop
            ? `销毁背包物品，${freeDrop ? '0 AP，随后继续决策' : '1 AP'}`
            : freeDrop
              ? '放到地上，0 AP，随后继续决策'
              : '放到地上，1 AP',
        ],
        [
          '放置物品',
          destructiveDrop ? 'place：放到脚下地面，1 AP，可被捡起' : '使用 drop 放到地上',
        ],
        ['非法动作', '消耗 1 AP，记录失败原因'],
        ['每日饱食度消耗', '成年 20 / 幼年 10'],
        ['饥饿伤害', '日末饱食度归零时，生命 -20'],
        [
          '携带容量',
          `${world ? (world.config.inventoryCapacity ?? 12) : config.inventoryCapacity} 单位；工具重 2，其余物品重 1`,
        ],
      ],
    },
    ...(social
      ? [
          {
            title: '孤单与交流',
            rows: [
              ['孤单条长度', '40–100；round(100 − 60 × 外向性)，越外向越短'],
              ['孤单增长', '连续 2 天未向人说话，从第 2 天日末起每天 +20'],
              ['交流缓解', '对活着的听众成功说话，每次 −20，并重置未交流天数'],
              ['有效说话', '普通说话或大声说话；仅听闻、自言自语不计'],
              ['抑郁状态', '孤单满条后进入，每日额外扣 10 血，孤单清零才解除'],
            ] as [string, string | number][],
          },
        ]
      : []),
    {
      title: '模型与运行预算',
      rows: [
        ['模型', world?.usage.model && world.usage.model !== '未连接' ? world.usage.model : model],
        ['调用上限', config.maxCalls.toLocaleString()],
        ['Token 上限', config.maxTokens.toLocaleString()],
        ['运行时长上限', `${config.maxMinutes} 分钟`],
        ['人口暂停阈值', `${config.populationLimit} 人`],
        ['费用上限', config.maxCost > 0 ? String(config.maxCost) : '关闭'],
      ],
    },
  ];
  return (
    <section className="config-page" aria-label="世界配置">
      <div className="heading">
        <div>
          <p className="eyebrow">WORLD CONFIGURATION</p>
          <h2>
            配置<span>。</span>
          </h2>
          <p className="description">
            {world ? '当前世界的规则与初始条件' : '下一轮世界的默认规则与初始条件'} ·{' '}
            {world?.rulesVersion ?? RULES_VERSION}
          </p>
        </div>
        <button className="secondary" onClick={onCreate}>
          设置下一轮世界
        </button>
      </div>
      <div className="config-sections">
        {sections.map((section) => (
          <section className="config-card" key={section.title}>
            <h3>{section.title}</h3>
            <dl>
              {section.rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {!legacy && (
        <p className="note">
          第 1 天获得的食物在第 {1 + config.foodShelfLifeDays} 天腐败。第 1 天采过的平原从第{' '}
          {1 + config.plainRecoveryDays}{' '}
          天开始恢复；再次采集会重新计算等待期。食物转移保留到期日期。母亲存活至妊娠期结束时，后代出生并拥有独立记忆。
        </p>
      )}
    </section>
  );
}
