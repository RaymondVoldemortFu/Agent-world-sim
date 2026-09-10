import type { Memory, WorldEvent } from '../sim/types';
import { db } from './store';
export interface Experience extends Memory {
  agentId: number;
  seq: number;
  eventType: string;
  decisionId?: string;
  position?: [number, number];
  cursor: number;
}
export function extractExperiences(e: WorldEvent): Omit<Experience, 'cursor'>[] {
  const groups = [
    ...(e.patch.agents ?? []).map((a) => ({ id: a.id, memories: a.memories })),
    ...(e.patch.agentChanges ?? []).map((a) => ({
      id: a.state.id,
      memories: a.memories?.append ?? [],
    })),
  ];
  return groups.flatMap((a) =>
    (a.memories ?? []).map((m) => ({
      ...m,
      agentId: a.id,
      seq: e.seq,
      eventType: e.type,
      decisionId: e.decisionId,
      position: e.position,
    })),
  );
}
export interface ExperienceQuery {
  agentId: number;
  q: string;
  source: string;
  start?: number;
  end?: number;
  through: number;
  before?: number;
}
// Page-local incremental cache. The component retains this instance for the current run.
export class LocalExperiences {
  private seq = 0;
  private rows: Experience[] = [];
  private seen = new Set<string>();
  private work = Promise.resolve();
  constructor(private runId: string) {}
  async query(q: ExperienceQuery) {
    const indexing = this.work.then(async () => {
      if (q.through <= this.seq) return;
      await db.events
        .where('[runId+seq]')
        .between([this.runId, this.seq], [this.runId, q.through], false, true)
        .each((e) => {
          for (const m of extractExperiences(e)) {
            const key = `${m.agentId}:${m.id}`;
            if (!this.seen.has(key)) {
              this.seen.add(key);
              this.rows.push({ ...m, cursor: this.rows.length + 1 });
            }
          }
          this.seq = e.seq;
        });
    });
    this.work = indexing.catch(() => {});
    await indexing;
    const needle = q.q.trim().toLowerCase();
    const found: Experience[] = [];
    for (let i = this.rows.length - 1; i >= 0 && found.length < 61; i--) {
      const r = this.rows[i];
      if (
        r.agentId === q.agentId &&
        r.seq <= q.through &&
        (!q.before || r.cursor < q.before) &&
        (!q.source || r.source === q.source) &&
        (q.start === undefined || r.day >= q.start) &&
        (q.end === undefined || r.day <= q.end) &&
        r.content.toLowerCase().includes(needle)
      )
        found.push(r);
    }
    return {
      experiences: found.slice(0, 60),
      hasMore: found.length > 60,
      nextCursor: found.length > 60 ? found[59].cursor : null,
      through: q.through,
    };
  }
}
