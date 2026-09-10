import Dexie, { type Table } from 'dexie';
import {
  type World,
  type WorldEvent,
  type DecisionRecord,
  type Snapshot,
  type Bundle,
  ConfigSchema,
} from '../sim/types';
import { hashWorld, SUPPORTED_REPLAY_VERSIONS } from '../sim/world';
import { applyEvent } from '../sim/engine';
import { contextHeads, transferContexts } from './context-archive';
interface StoredRun {
  id: string;
  updated: number;
  world: World;
  elapsedMs: number;
}
class WorldDB extends Dexie {
  runs!: Table<StoredRun, string>;
  events!: Table<WorldEvent & { runId: string }, [string, number]>;
  decisions!: Table<DecisionRecord, string>;
  snapshots!: Table<Snapshot & { runId: string }, [string, number]>;
  constructor() {
    super('agent-world-v1');
    this.version(1).stores({
      runs: 'id,updated',
      events: '[runId+seq],runId',
      decisions: 'id,runId,status',
      snapshots: '[runId+seq],runId',
    });
  }
}
export const db = new WorldDB();
export const snapshot = (w: World): Snapshot => ({
  seq: w.seq,
  day: w.tick,
  hash: hashWorld(w),
  world: structuredClone(w),
});
export async function initialize(w: World) {
  await db.transaction('rw', db.runs, db.snapshots, async () => {
    await db.runs.put({ id: w.id, updated: Date.now(), world: w, elapsedMs: 0 });
    await db.snapshots.put({ ...snapshot(w), runId: w.id });
  });
}
export async function latest() {
  return db.runs.orderBy('updated').last();
}
export async function commit(
  w: World,
  e: WorldEvent,
  r: DecisionRecord | undefined,
  elapsedMs: number,
) {
  await db.transaction('rw', db.runs, db.events, db.decisions, db.snapshots, async () => {
    if (await db.events.get([w.id, e.seq])) throw new Error('重复提交被拒绝');
    await db.events.put({ ...e, runId: w.id });
    if (r) await db.decisions.put({ ...r, status: 'committed' });
    await db.runs.put({ id: w.id, updated: Date.now(), world: w, elapsedMs });
    if (e.type === 'day_end' && (e.day % 5 === 0 || w.cursor.phase === 'complete'))
      await db.snapshots.put({ ...snapshot(w), runId: w.id });
  });
}
export async function exportBundle(w: World): Promise<Bundle> {
  const bundle = await db.transaction(
    'r',
    db.runs,
    db.events,
    db.decisions,
    db.snapshots,
    async () => {
      const stored = await db.runs.get(w.id);
      const current = stored?.world ?? w;
      const [events, records, snapshots] = await Promise.all([
        db.events
          .where('runId')
          .equals(w.id)
          .and((e) => e.seq <= current.seq)
          .toArray(),
        db.decisions.where('runId').equals(w.id).toArray(),
        db.snapshots
          .where('runId')
          .equals(w.id)
          .and((s) => s.seq <= current.seq)
          .toArray(),
      ]);
      const ids = new Set(events.map((e) => e.decisionId));
      return {
        format: 'agent-world-v1' as const,
        elapsedMs: stored?.elapsedMs ?? 0,
        world: current,
        events,
        decisions: records.filter((r) => r.status === 'committed' && ids.has(r.id)),
        snapshots,
      };
    },
  );
  const contextNodes = await transferContexts(
    'export',
    bundle.world.id,
    contextHeads(bundle.world, bundle.decisions),
  );
  return { ...bundle, contextNodes };
}
export function validateBundle(b: unknown): asserts b is Bundle {
  const v = b as Bundle;
  if (
    !v ||
    v.format !== 'agent-world-v1' ||
    v.world?.version !== 1 ||
    !SUPPORTED_REPLAY_VERSIONS.includes(v.world?.rulesVersion)
  )
    throw new Error('不支持的数据包或规则版本');
  ConfigSchema.parse(v.world.config);
  if (
    !Array.isArray(v.events) ||
    !Array.isArray(v.decisions) ||
    !Array.isArray(v.snapshots) ||
    v.snapshots.length === 0
  )
    throw new Error('数据包记录不完整');
  if (
    v.world.tiles.length !==
      v.world.config.size ** 2 * (v.world.ecology ? v.world.config.regions : 1) ||
    new Set(v.world.agents.map((a) => a.id)).size !== v.world.agents.length
  )
    throw new Error('世界结构不合法');
  const initial = v.snapshots.find((s) => s.seq === 0);
  if (!initial || hashWorld(initial.world) !== initial.hash) throw new Error('初始快照校验失败');
  const replay = structuredClone(initial.world);
  for (const e of v.events) {
    applyEvent(replay, e);
    const s = v.snapshots.find((s) => s.seq === e.seq);
    if (s && hashWorld(replay) !== s.hash) throw new Error(`快照 ${s.seq} 校验失败`);
  }
  if (hashWorld(replay) !== hashWorld(v.world)) throw new Error('最终状态与历史不一致');
}
export async function importBundle(b: Bundle) {
  validateBundle(b);
  await transferContexts('import', b.world.id, contextHeads(b.world, b.decisions), b.contextNodes);
  await db.transaction('rw', db.runs, db.events, db.decisions, db.snapshots, async () => {
    await db.events.where('runId').equals(b.world.id).delete();
    await db.decisions.where('runId').equals(b.world.id).delete();
    await db.snapshots.where('runId').equals(b.world.id).delete();
    await db.runs.put({
      id: b.world.id,
      updated: Date.now(),
      world: b.world,
      elapsedMs: b.elapsedMs ?? b.world.usage.elapsedMs,
    });
    await db.events.bulkPut(b.events.map((e) => ({ ...e, runId: b.world.id })));
    await db.decisions.bulkPut(b.decisions);
    await db.snapshots.bulkPut(b.snapshots.map((s) => ({ ...s, runId: b.world.id })));
  });
}
export async function replayAt(w: World, seq: number) {
  const snaps = await db.snapshots.where('runId').equals(w.id).toArray();
  const s = snaps.filter((s) => s.seq <= seq).sort((a, b) => b.seq - a.seq)[0];
  if (!s) throw new Error('缺少历史快照');
  const out = structuredClone(s.world);
  const events = await db.events
    .where('[runId+seq]')
    .between([w.id, s.seq + 1], [w.id, seq], true, true)
    .toArray();
  for (const e of events) applyEvent(out, e);
  return out;
}
