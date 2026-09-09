import {
  DecisionSchema,
  ReflectionSchema,
  type DecisionRecord,
  type World,
  type Decision,
  type Reflection,
} from '../sim/types';
import { observe, nextTask } from '../sim/engine';
export type SavePending = (r: DecisionRecord) => Promise<void>;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function makeRecord(w: World, task = nextTask(w)): DecisionRecord {
  if (!task) throw new Error('No agent task');
  return {
    id: task.id,
    rulesVersion: w.rulesVersion,
    schemaVersion: ['mvp-1.6.0', 'mvp-1.7.0'].includes(w.rulesVersion)
      ? 'action-v4'
      : w.rulesVersion === 'mvp-1.5.0'
        ? 'action-v3'
        : ['mvp-1.3.0', 'mvp-1.4.0'].includes(w.rulesVersion)
          ? 'action-v2'
          : 'action-v1',
    runId: w.id,
    day: w.tick,
    agentId: task.agent.id,
    kind: task.kind,
    context: structuredClone(observe(w, task.agent)),
    status: 'pending',
    attempts: [],
  };
}
export async function requestDecision(
  record: DecisionRecord,
  save: SavePending,
  base = '',
  fetcher: typeof fetch = fetch,
): Promise<DecisionRecord> {
  if (record.fatal) {
    record.status = 'pending';
    delete record.fatal;
    delete record.technicalFailure;
    delete record.decision;
    delete record.reflection;
  }
  if (record.status !== 'pending') return record;
  await save(record);
  let repair: string | undefined;
  let retries = 0;
  while (true) {
    const start = Date.now();
    let data: any;
    let status = 0;
    try {
      const res = await fetcher(`${base}/api/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: record.runId,
          decisionId: record.id,
          context: record.context,
          kind: record.kind,
          repair,
        }),
        signal: AbortSignal.timeout(55000),
      });
      status = res.status;
      if (!res.ok) throw new Error(`HTTP ${status}`);
      data = await res.json();
      record.attempts.push({
        status,
        content: data.content,
        usage: data.usage,
        elapsedMs: data.elapsedMs ?? Date.now() - start,
        model: data.model,
        promptVersion: data.promptVersion,
      });
    } catch (e) {
      record.attempts.push({
        status,
        error: e instanceof Error ? e.message : 'Network error',
        elapsedMs: Date.now() - start,
      });
      await save(record);
      if ([400, 401, 403, 404, 413, 503].includes(status)) {
        record.fatal = `模型配置异常（HTTP ${status}），请检查后端配置`;
        record.technicalFailure = true;
        break;
      }
      if (retries++ < 2) {
        await delay(500 * 2 ** retries);
        continue;
      }
      record.technicalFailure = true;
      break;
    }
    try {
      const content = typeof data.content === 'string' ? data.content : '';
      const json = JSON.parse(content);
      if (record.kind === 'action') record.decision = DecisionSchema.parse(json) as Decision;
      else record.reflection = ReflectionSchema.parse(json);
      break;
    } catch (e) {
      record.attempts[record.attempts.length - 1].error = `格式校验：${String(e).slice(0, 1000)}`;
      if (!repair) {
        repair = String(e).slice(0, 1800);
        await save(record);
        continue;
      }
      break;
    }
  }
  if (record.kind === 'action' && !record.decision)
    record.decision = {
      intent: record.technicalFailure
        ? '模型请求失败，等待下一次机会'
        : '输出格式无效，等待下一次机会',
      action: { type: 'wait' },
    };
  if (record.kind === 'reflection' && !record.reflection)
    record.reflection = { summary: '此次记忆整理未成功，保留原始经历。', claims: [] };
  record.status = 'received';
  await save(record);
  return record;
}
export function account(w: World, r: DecisionRecord) {
  let hasError = false;
  for (const a of r.attempts) {
    w.usage.calls++;
    w.usage.elapsedMs += a.elapsedMs;
    if (a.error) {
      w.usage.errors++;
      hasError = true;
      if (a.status === 200) w.usage.repairs++;
    }
    const u = a.usage;
    if (u) {
      w.usage.inputTokens += u.prompt_tokens ?? 0;
      w.usage.outputTokens += u.completion_tokens ?? 0;
      w.usage.cachedTokens += u.prompt_cache_hit_tokens ?? 0;
    } else if (a.content) {
      w.usage.inputTokens += Math.ceil(JSON.stringify(r.context).length / 2);
      w.usage.outputTokens += Math.ceil(a.content.length / 2);
      w.usage.estimated = true;
    }
    if (a.model) w.usage.model = a.model;
  }
  w.usage.consecutiveErrors = r.technicalFailure ? w.usage.consecutiveErrors + 1 : 0;
  w.usage.cost =
    ((w.usage.inputTokens - w.usage.cachedTokens) * w.config.inputPrice +
      w.usage.cachedTokens * w.config.cachePrice +
      w.usage.outputTokens * w.config.outputPrice) /
    1000000;
  return hasError;
}
export function budgetReason(w: World, elapsedMs: number): string | undefined {
  if (w.agents.filter((a) => !a.death).length > w.config.populationLimit) return '人口达到运行阈值';
  if (w.usage.consecutiveErrors >= 5) return '连续 5 次技术失败，已暂停';
  if (w.usage.calls >= w.config.maxCalls) return '已达到模型调用预算';
  if (w.usage.inputTokens + w.usage.outputTokens >= w.config.maxTokens) return '已达到 token 预算';
  if (elapsedMs >= w.config.maxMinutes * 60000) return '已达到运行时长预算';
  if (w.config.maxCost > 0 && w.usage.cost >= w.config.maxCost) return '已达到估算费用预算';
}

export function prepareRecord(
  w: World,
  task: NonNullable<ReturnType<typeof nextTask>>,
  saved?: DecisionRecord,
): DecisionRecord {
  const current = makeRecord(w, task);
  if (!saved) return current;
  if (JSON.stringify(saved.context) === JSON.stringify(current.context)) return saved;
  // A stale imported/prefetched response is never silently applied. Preserve
  // its billable attempts together with their original input, then request anew.
  current.attempts = saved.attempts.map((a) => ({ ...a, discarded: true, context: saved.context }));
  return current;
}
