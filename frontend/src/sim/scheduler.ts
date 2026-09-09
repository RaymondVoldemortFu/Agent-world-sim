import type { Agent, World } from './types';
import { nextTask } from './engine';
export type ScheduledTask = NonNullable<ReturnType<typeof nextTask>>;
export function conflicts(w: World, a: Agent, b: Agent): boolean {
  // Visibility radius (1) + maximum movement per action (1). A one-step move
  // at distance 2 can enter the other actor's observation before its decision.
  if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 2) return true;
  // Revoking a pending joint proposal changes the partner's available proposals,
  // even after the pair has moved apart. Preserve this non-spatial dependency.
  return w.proposals.some(
    (p) =>
      !p.completed &&
      !p.revoked &&
      w.tick < p.day + 3 &&
      ((p.from === a.id && p.to === b.id) || (p.from === b.id && p.to === a.id)),
  );
}
export function nextBatch(w: World, limit: number): ScheduledTask[] {
  const first = nextTask(w);
  if (!first) return [];
  const batch: ScheduledTask[] = [];
  const phase = w.cursor.phase;
  for (const id of w.cursor.ids.slice(w.cursor.index)) {
    const agent = w.agents.find((a) => a.id === id);
    if (!agent || agent.death || (phase === 'actions' && agent.ap <= 0)) continue;
    if (batch.length >= Math.max(1, Math.floor(limit))) break;
    // A contiguous prefix is intentional: skipping a blocked lower ID could let
    // its as-yet-unknown action invalidate a higher ID's prefetched observation.
    if (phase === 'actions' && batch.some((t) => conflicts(w, t.agent, agent))) break;
    batch.push({
      kind: first.kind,
      agent,
      id: `${w.id}:${w.tick}:${phase}:${w.cursor.round}:${agent.id}`,
    });
  }
  return batch;
}
