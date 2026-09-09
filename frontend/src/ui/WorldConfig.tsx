import type { Config, World } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/types';
import { RULES_VERSION, SHOUT_AP, SHOUT_RADIUS } from '../sim/world';

export default function WorldConfig({
  world,
  draft,
  model,
  onCreate,
}: {
  world?: World;
  draft: Config;
  model: string;
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
        ['初始分布', config.spawn === 'clusters' ? '分区随机' : '全图均匀随机'],
        ['观察范围', '以本人为中心的九宫格'],
        ['全力观察', fullPerception ? '2 AP，3 格内（含斜向），保存当时环境快照' : '此版本未提供'],
        ['尸体', fullPerception ? '死亡后保留在原地，可观察，不是交流对象' : '此版本未提供'],
        ['观察方式', automatic ? '每次决策自动更新，0 AP' : '决策附带视野，look 动作另耗 1 AP'],
        ['普通说话', '1 AP，周围九宫格可听见'],
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
