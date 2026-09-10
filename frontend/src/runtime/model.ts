import { observeEco } from '../ecology/engine';
import type { EcoObservation } from '../ecology/types';
import { BrainOutputSchema } from '../ecology/types';
import {
  shouldThink,
  ruleDecision,
  interpret,
  compactContext,
  deepReflectionDue,
} from '../brain/controller';
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
  const record: DecisionRecord = {
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
    context: w.ecology ? observeEco(w, task.agent) : structuredClone(observe(w, task.agent)),
    status: 'pending',
    attempts: [],
  };
  if (w.ecology) {
    record.schemaVersion = 'hybrid-1';
    const o = record.context as EcoObservation;
    if (!shouldThink(o)) {
      record.decision = ruleDecision(o);
      record.source = record.decision.brainUpdate!.brain.source;
      record.status = 'received';
      record.context = compactContext(o);
    } else {
      record.source = 'llm';
      record.brainContext = compactContext(o);
    }
  }
  return record;
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
  const hybrid = record.schemaVersion === 'hybrid-1';
  const maxAttempts = hybrid
    ? Math.max(
        0,
        Math.min(
          3,
          (record.context as EcoObservation).policy.remainingCalls,
          (record.context as EcoObservation).policy.llmDailyCalls -
            (record.context as EcoObservation).self.brain.callsDay,
        ),
      )
    : 4;
  while (record.attempts.length < maxAttempts) {
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
          context: record.brainContext ?? record.context,
          kind: record.kind,
          repair,
          experiment: record.storageExperiment,
          spentCalls: record.attempts.length,
          spentAttemptIds: record.attempts.flatMap((a) => (a.id ? [a.id] : [])),
          spentTokens: record.attempts.reduce(
            (n, a) => n + (a.usage?.prompt_tokens ?? 0) + (a.usage?.completion_tokens ?? 0),
            0,
          ),
          parentTurnId: repair
            ? record.attempts.filter((a) => a.contextTrace).at(-1)?.contextTrace?.turnId
            : undefined,
        }),
        signal: AbortSignal.timeout(
          hybrid && deepReflectionDue(record.context as EcoObservation) ? 300000 : 115000,
        ),
      });
      status = res.status;
      if (!res.ok) throw new Error(`HTTP ${status}`);
      data = await res.json();
      for (const attempt of data.auxiliaryAttempts ?? [])
        if (!record.attempts.some((a) => a.id === attempt.id)) record.attempts.push(attempt);
      if (data.deferred) break;
      if (data.failure) {
        // The server returns paid compaction usage even when the following decision fails.
        if (data.failure.purpose !== 'compression') record.attempts.push(data.failure);
        await save(record);
        if (retries++ < 2) {
          await delay(500 * 2 ** retries);
          continue;
        }
        record.technicalFailure = true;
        break;
      }
      const repeated = data.id && record.attempts.some((a) => a.id === data.id);
      if (!repeated)
        record.attempts.push({
          id: data.id,
          purpose: data.purpose ?? 'decision',
          contextTrace: data.contextTrace,
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
      if (record.schemaVersion === 'hybrid-1') {
        const out = BrainOutputSchema.parse(json);
        const o = record.context as EcoObservation;
        if (deepReflectionDue(o) && !out.reflection)
          throw Error('深度反思必须输出 reflection.summary 和 reflection.plan');
        if (out.speech?.targetId && !o.people.some((p) => p.id === out.speech!.targetId))
          throw Error('speech.targetId 必须是当前 people 中的活人ID；无人时省略speech');
        record.decision = interpret(
          record.context as EcoObservation,
          out,
          record.attempts.length,
          record.attempts.reduce(
            (n, a) => n + (a.usage?.prompt_tokens ?? 0) + (a.usage?.completion_tokens ?? 0),
            0,
          ),
        );
        if (data.contextTrace)
          record.decision.brainUpdate!.brain.contextHead = data.contextTrace.turnId;
      } else if (record.kind === 'action') record.decision = DecisionSchema.parse(json) as Decision;
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
  if (hybrid && !record.decision) {
    record.decision = ruleDecision(record.context as EcoObservation, 'fallback');
    record.decision.brainUpdate!.brain.callsDay += record.attempts.length;
    record.decision.brainUpdate!.brain.calls += record.attempts.length;
    record.decision.brainUpdate!.brain.lastThought = record.day;
    record.decision.brainUpdate!.brain.tokensDay =
      (record.decision.brainUpdate!.brain.tokensDay ?? 0) +
      record.attempts.reduce(
        (n, a) => n + (a.usage?.prompt_tokens ?? 0) + (a.usage?.completion_tokens ?? 0),
        0,
      );
    record.source = 'fallback';
    delete record.fatal;
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
  if (hybrid) {
    record.context = record.brainContext ?? compactContext(record.context as EcoObservation);
    delete record.brainContext;
  }
  record.status = 'received';
  await save(record);
  return record;
}
export function account(w: World, r: DecisionRecord) {
  // Reconcile against committed state so billable discarded prefetches also count
  // toward personal quotas when resuming with a refreshed observation.
  if (w.ecology && r.decision?.brainUpdate) {
    const current = w.agents.find((a) => a.id === r.agentId)!.brain!,
      updated = r.decision.brainUpdate.brain;
    updated.callsDay = current.callsDay + r.attempts.length;
    updated.calls = current.calls + r.attempts.length;
    updated.tokensDay =
      (current.tokensDay ?? 0) +
      r.attempts.reduce(
        (n, a) => n + (a.usage?.prompt_tokens ?? 0) + (a.usage?.completion_tokens ?? 0),
        0,
      );
  }

  let hasError = false;
  for (const a of r.attempts) {
    w.usage.calls++;
    w.usage.elapsedMs += a.elapsedMs;
    if (a.error) {
      w.usage.errors++;
      hasError = true;
      if (a.status === 200 && a.purpose !== 'compression') w.usage.repairs++;
    }
    const u = a.usage;
    if (a.purpose === 'compression') {
      w.usage.contextCompressions = (w.usage.contextCompressions ?? 0) + 1;
      w.usage.compressionInputTokens =
        (w.usage.compressionInputTokens ?? 0) + (u?.prompt_tokens ?? 0);
      w.usage.compressionOutputTokens =
        (w.usage.compressionOutputTokens ?? 0) + (u?.completion_tokens ?? 0);
    }
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
  if (!w.ecology && w.usage.consecutiveErrors >= 5) return '连续 5 次技术失败，已暂停';
  if (!w.ecology && w.usage.calls >= w.config.maxCalls) return '已达到模型调用预算';
  if (!w.ecology && w.usage.inputTokens + w.usage.outputTokens >= w.config.maxTokens)
    return '已达到 token 预算';
  if (elapsedMs >= w.config.maxMinutes * 60000) return '已达到运行时长预算';
  if (!w.ecology && w.config.maxCost > 0 && w.usage.cost >= w.config.maxCost)
    return '已达到估算费用预算';
}

export function prepareRecord(
  w: World,
  task: NonNullable<ReturnType<typeof nextTask>>,
  saved?: DecisionRecord,
): DecisionRecord {
  const current = makeRecord(w, task);
  if (!saved) return current;
  if (
    JSON.stringify(saved.context) === JSON.stringify(current.context) ||
    (w.ecology &&
      saved.status !== 'pending' &&
      JSON.stringify(saved.context) === JSON.stringify(current.brainContext))
  )
    return saved;
  // A stale imported/prefetched response is never silently applied. Preserve
  // its billable attempts together with their original input, then request anew.
  current.attempts = saved.attempts.map((a) => ({ ...a, discarded: true, context: saved.context }));
  return current;
}
