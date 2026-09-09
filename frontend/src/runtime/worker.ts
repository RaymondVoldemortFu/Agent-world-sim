/// <reference lib="webworker" />
import { createWorld, RULES_VERSION } from '../sim/world';
import { act, endDay, nextTask, reflect, changeBudget, resetFailureStreak } from '../sim/engine';
import {
  db,
  initialize,
  latest,
  commit,
  exportBundle,
  importBundle,
  replayAt,
  validateBundle,
} from './store';
import { nextBatch } from '../sim/scheduler';
import { account, budgetReason, prepareRecord, requestDecision } from './model';
import type { World, WorldEvent, Config, Bundle } from '../sim/types';
let world: World | undefined;
let running = false;
let stop = false;
let elapsed = 0;
let delayMs = 50;
let concurrency = 6;
let status = '准备就绪';
const send = (data: unknown) => self.postMessage(data);
async function publish(event?: WorldEvent) {
  send({
    type: 'state',
    world,
    running,
    status,
    event: event ? { ...event, patch: undefined } : undefined,
  });
}
async function restore() {
  const run = await latest();
  if (run) {
    world = run.world;
    elapsed = run.elapsedMs;
    status = world.cursor.phase === 'complete' ? '实验已完成' : '已恢复上次提交的世界';
    await publish();
  } else {
    world = undefined;
    status = '准备就绪';
    await publish();
  }
}
async function locked(fn: () => Promise<void>) {
  if (!world) throw new Error('请先创建世界');
  await navigator.locks.request(`agent-world:${world.id}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('另一个标签页正在运行此世界');
    await fn();
  });
}
async function loop(single = false) {
  if (running || !world) return;
  stop = false;
  running = true;
  status = '正在运行';
  await publish();
  const started = Date.now();
  try {
    await locked(async () => {
      // Refresh after taking the lock; another tab may have advanced the stored run.
      const saved = await db.runs.get(world!.id);
      if (saved) {
        world = saved.world;
        elapsed = saved.elapsedMs;
      }
      if (world!.rulesVersion !== RULES_VERSION)
        throw new Error('该存档使用旧版规则，可查看与回放。请新建世界运行当前规则。');
      if (world!.usage.consecutiveErrors >= 5) {
        const e = resetFailureStreak(world!);
        await commit(world!, e, undefined, elapsed);
      }
      while (world!.cursor.phase !== 'complete' && !stop) {
        const w = world!;
        const reason = budgetReason(w, elapsed + Date.now() - started);
        if (reason) {
          status = reason;
          break;
        }
        const tasks = nextBatch(
          w,
          single ? 1 : Math.min(concurrency, Math.max(1, w.config.maxCalls - w.usage.calls)),
        );
        if (tasks.length) {
          status = `第 ${w.tick} 天 · 并行 ${tasks.length} · ${tasks[0].kind === 'reflection' ? '正在整理记忆' : '正在决策'} ${tasks.map((t) => '#' + t.agent.id).join('、')}`;
          send({ type: 'progress', status, agentIds: tasks.map((t) => t.agent.id) });
          const outcomes = await Promise.allSettled(
            tasks.map(async (task) => {
              const saved = await db.decisions.get(task.id);
              return requestDecision(prepareRecord(w, task, saved), async (r) => {
                await db.decisions.put(r);
              });
            }),
          );
          const failure = outcomes.find((r) => r.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
          const records = outcomes.map(
            (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof requestDecision>>>).value,
          );
          let fatal = false;
          for (let i = 0; i < records.length; i++) {
            const record = records[i],
              task = nextTask(w);
            if (!task || task.id !== record.id) throw new Error('并行结算顺序不一致');
            if (record.fatal) {
              status = record.fatal;
              world = (await db.runs.get(w.id))!.world;
              fatal = true;
              break;
            }
            account(w, record);
            const event =
              task.kind === 'action'
                ? act(w, task.agent.id, record.decision!, task.id)
                : reflect(w, task.agent.id, record.reflection!, task.id);
            await commit(w, event, record, elapsed + Date.now() - started);
            status = event.text;
            if (i === records.length - 1 || w.cursor.freeActions) await publish(event);
            // Later independent replies remain saved; resume this actor's slot
            // before committing those replies in their original ID order.
            if (w.cursor.freeActions) break;
          }
          if (fatal) break;
        } else {
          const event = endDay(w);
          await commit(w, event, undefined, elapsed + Date.now() - started);
          status = event.text;
          await publish(event);
        }
        if (single) break;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      }
    });
  } catch (e) {
    status = `已暂停：${e instanceof Error ? e.message : String(e)}`;
    const saved = world ? await db.runs.get(world.id) : undefined;
    if (saved) world = saved.world;
  } finally {
    elapsed += Date.now() - started;
    running = false;
    if (world?.cursor.phase === 'complete') status = '100% · 实验已完成';
    else if (stop) status = '已暂停，历史已保存';
    await publish();
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'restore') {
      if (running) throw new Error('请先暂停当前运行');
      await restore();
    } else if (data.type === 'pause') {
      stop = true;
      status = '正在等待当前并行批次提交后暂停…';
      send({ type: 'progress', status });
    } else if (data.type === 'concurrency') {
      const n = Number(data.value);
      if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error('并发上限须为1到16');
      concurrency = n;
    } else if (data.type === 'speed') delayMs = data.delay;
    else if (data.type === 'run' || data.type === 'step') {
      void loop(data.type === 'step');
    } else {
      if (running) throw new Error('请等待当前运行暂停后再操作');
      if (data.type === 'create') {
        world = createWorld(data.config as Partial<Config>);
        elapsed = 0;
        await initialize(world);
        status = '新世界已生成';
        await publish();
      }
      if (data.type === 'export' && world)
        send({ type: 'export', bundle: await exportBundle(world) });
      if (data.type === 'import') {
        validateBundle(data.bundle);
        const previous = world;
        world = (data.bundle as Bundle).world;
        try {
          await locked(async () => {
            await importBundle(data.bundle);
          });
        } catch (e) {
          world = previous;
          throw e;
        }
        elapsed = (await db.runs.get(world!.id))!.elapsedMs;
        status = '实验记录导入成功';
        await publish();
      }
      if (data.type === 'replay' && world)
        send({ type: 'replay', world: await replayAt(world, data.seq) });
      if (data.type === 'budget' && world) {
        await locked(async () => {
          world = (await db.runs.get(world!.id))!.world;
          const e = changeBudget(world, data.config);
          await commit(world, e, undefined, elapsed);
          status = e.text;
        });
        await publish();
      }
      if (data.type === 'current') await publish();
    }
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
