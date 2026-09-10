import fs from 'node:fs';
import path from 'node:path';
import { lines } from './journal';
import type { World, DecisionRecord, WorldEvent } from '../frontend/src/sim/types';
import { ITEMS, RECIPES, BUILDINGS } from '../frontend/src/ecology/catalog';
import { energy } from '../frontend/src/ecology/batches';
const folder = path.resolve(process.argv[2]);
const w: World = JSON.parse(fs.readFileSync(path.join(folder, 'checkpoint.json'), 'utf8')).world;
if (w.cursor.phase !== 'complete' || w.metrics.length !== w.config.days)
  throw Error('Experiment must complete before reporting');
const counter: Record<string, number> = {},
  failures: Record<string, number> = {},
  decisions: Record<string, number> = {};
let billable = 0,
  withModel = 0,
  modelTokens = 0,
  ruleTokens = 0,
  maxAgentDailyCalls = 0;
const byAgentDay = new Map<string, number>();
for await (const line of lines(path.join(folder, 'events.jsonl'))) {
  const ev = JSON.parse(line) as WorldEvent;
  counter[ev.type] = (counter[ev.type] ?? 0) + 1;
  if (!ev.success) {
    const key = ev.text.replace(/^.*?失败：/, '');
    failures[key] = (failures[key] ?? 0) + 1;
  }
}
for await (const line of lines(path.join(folder, 'decisions.jsonl'))) {
  const r = JSON.parse(line) as DecisionRecord;
  const source = r.decision?.brainUpdate?.brain.source ?? r.source ?? 'unknown';
  decisions[source] = (decisions[source] ?? 0) + 1;
  billable += r.attempts.length;
  if (r.attempts.length) {
    withModel++;
    const key = `${r.day}:${r.agentId}`,
      n = (byAgentDay.get(key) ?? 0) + r.attempts.length;
    byAgentDay.set(key, n);
    maxAgentDailyCalls = Math.max(maxAgentDailyCalls, n);
    for (const a of r.attempts)
      modelTokens += (a.usage?.prompt_tokens ?? 0) + (a.usage?.completion_tokens ?? 0);
  } else ruleTokens++;
}
const jobs: Record<string, { started: number; complete: number; operators: number[] }> = {};
for (const j of w.ecology!.jobs) {
  const r = (jobs[j.recipe] ??= { started: 0, complete: 0, operators: [] });
  r.started++;
  if (j.state === 'complete') r.complete++;
  r.operators = [...new Set([...r.operators, ...j.operators])];
}
const result = {
  experiment: path.basename(folder),
  days: w.metrics.length,
  population: w.config.population,
  alive: w.agents.filter((a) => !a.death).length,
  deaths: w.agents
    .filter((a) => a.death)
    .map((a) => ({ id: a.id, day: a.death!.day, cause: a.death!.cause })),
  pregnancies: w.agents
    .filter((a) => a.pregnancy)
    .map((a) => ({ id: a.id, due: a.pregnancy!.due })),
  usage: w.usage,
  billableAttempts: billable,
  decisions,
  events: counter,
  failures,
  maxAgentDailyCalls,
  jobs,
  cooperativeJobs: w.ecology!.jobs.filter((j) => j.operators.length > 1).length,
  fields: w.tiles.flatMap((t) =>
    t.eco!.fields.map((f) => ({ region: t.eco!.region, x: t.x, y: t.y, ...f })),
  ),
  buildings: w.tiles.flatMap((t) =>
    t.eco!.structures.map((s) => ({
      region: t.eco!.region,
      kind: s.kind,
      complete: s.progress >= BUILDINGS[s.kind].minutes,
    })),
  ),
  knowledge: w.agents.map((a) => ({
    id: a.id,
    role: a.role,
    known: a.eco!.knowledge.length,
    skills: a.eco!.skills,
  })),
  ledger: w.ecology!.ledger,
  ruleAvoidedRequests: ruleTokens,
  modelDecisions: withModel,
};
fs.writeFileSync(path.join(folder, 'ecology-report.json'), JSON.stringify(result, null, 2));
const total = Object.values(decisions).reduce((a, b) => a + b, 0);
const num = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const jobLines = Object.entries(jobs)
  .map(
    ([id, r]) =>
      `| ${RECIPES[id].name} (${id}) | ${r.started} | ${r.complete} | ${r.operators.length} |`,
  )
  .join('\n');
const md = `# ECO 02：100 天 / 20 人实验\n\n实验：\`${path.basename(folder)}\`，规则 \`${w.rulesVersion}\`。${w.config.size}×${w.config.size} 格 / 区域，共 ${w.config.regions} 个区域；${w.config.ecoPreset} 开局，年内第 ${w.config.startDay}–${w.config.startDay + w.config.days - 1} 天。\n\n## 完成情况\n\n- 已完成 ${w.metrics.length}/${w.config.days} 天，初始 ${w.config.population} 人，最终 ${result.alive} 人；出生 ${w.counters.births}，死亡 ${w.counters.deaths}，妊娠 ${result.pregnancies.length}。\n- 交流 ${w.counters.chats} 次，赠予 ${w.counters.gifts} 次，发现 / 学习 ${w.counters.discoveries} 次。\n- 工序 ${w.ecology!.jobs.length} 个，其中 ${w.ecology!.jobs.filter((j) => j.state === 'complete').length} 个完成、${result.cooperativeJobs} 个有多位劳动者。田块 ${result.fields.length} 个；建筑 / 工程 ${result.buildings.length} 个。\n\n## 模型调用\n\n| 指标 | 结果 |\n| --- | ---: |\n| 实际 API 请求（包含重试、修复） | ${num(w.usage.calls)} |\n| 输入 Token | ${num(w.usage.inputTokens)} |\n| 输出 Token | ${num(w.usage.outputTokens)} |\n| 缓存命中 Token | ${num(w.usage.cachedTokens)} |\n| 规则 / 持续计划 / 降级执行次数 | ${num(ruleTokens)} |\n| 含真实模型尝试的决策 | ${num(withModel)} |\n| 同一人同一天最大请求数 | ${maxAgentDailyCalls} |\n| 已知技术 / 格式错误 | ${w.usage.errors} |\n\n以本轮 ${num(total)} 个决策都调用一次模型作为调用量对照，混合控制器实际请求减少约 ${num(100 * (1 - w.usage.calls / total))}%。这是相同动作轨迹的调用数对照，不能当作另一场完整 LLM 原子控制实验的实测 Token 降幅。Token 表来自真实接口返回；配置价格为零时没有实际金额估计。\n\n## 实际产业\n\n| 工艺 | 启动 | 完成 | 参与过的人数 |\n| --- | ---: | ---: | ---: |\n${jobLines || '| 无 | 0 | 0 | 0 |'}\n\n实现中的完整工艺目录与本轮真正发生的工艺分别统计。本轮100天覆盖夏季、秋收和秋播，不能证明所有技术都会由居民自发使用，也不能检验280天妊娠或整年农业。全年生态、种植和工艺守恒另由确定性检查覆盖。\n\n## 结果与审计入口\n\n- [实验 UI](http://127.0.0.1:5173/?experiment=${path.basename(folder)})\n- 实验目录：\`${path.relative(process.cwd(), folder)}\`\n- \`verification.json\`：事件回放、快照与最终状态一致性。\n- \`ecology-report.json\`：逐类动作、失败、工序、人员技能和资源账。\n- \`implementation.jsonl\`：执行代码摘要；\`decisions.jsonl\`：模型尝试与决策来源；\`events.jsonl\`：物理结算。\n\n死亡原因：${result.deaths.map((a) => `#${a.id} 第${a.day}天 ${a.cause}`).join('；') || '无'}。\n\n主要动作失败：${
  Object.entries(failures)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([s, n]) => `${s}（${n} 次）`)
    .join('；') || '无'
}。\n`;
fs.writeFileSync('docs/ECOLOGY_V2_100DAY_REPORT.md', md);
console.log(
  JSON.stringify(
    {
      days: result.days,
      alive: result.alive,
      usage: result.usage,
      decisions,
      jobs,
      cooperativeJobs: result.cooperativeJobs,
      fields: result.fields.length,
      buildings: result.buildings.length,
    },
    null,
    2,
  ),
);
