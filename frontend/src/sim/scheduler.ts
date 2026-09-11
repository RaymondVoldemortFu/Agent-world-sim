import { SHOUT_RADIUS } from './world';
import { readyActors, ecoId } from '../ecology/engine';
import type { Agent, World } from './types';
import { nextTask, decisionIdFor } from './engine';
export type ScheduledTask = NonNullable<ReturnType<typeof nextTask>>;
export function conflicts(w: World, a: Agent, b: Agent): boolean {
  // Adjacent defenders can retreat two tiles; their visible neighbors also conflict.
  // Their visible neighbors must not decide from a stale prefetched observation.
  if (
    w.ecology &&
    a.eco?.region === b.eco?.region &&
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 5 &&
    (w.ecology.beasts ?? []).some(
      (v) =>
        v.hp > 0 &&
        v.region === a.eco?.region &&
        (Math.max(Math.abs(v.x - a.x), Math.abs(v.y - a.y)) <= 1 ||
          Math.max(Math.abs(v.x - b.x), Math.abs(v.y - b.y)) <= 1),
    )
  )
    return true;
  // A human attack can make a colocated defender retreat two tiles (plus vision 1).
  // Visibility radius (1) + maximum movement per action (1). A one-step move
  // at distance 2 can enter the other actor's observation before its decision.
  // Shout also reaches radius 5, so listeners must stay in separate batches.
  if (
    (!w.ecology || a.eco?.region === b.eco?.region) &&
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= Math.max(SHOUT_RADIUS, w.ecology ? 3 : 2)
  )
    return true;
  // Survey is sampled during commit and saved as a frozen private snapshot.
  // It does not expand the live observation read by subsequent decisions.
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
  if (w.ecology) {
    limit = Math.min(limit, Math.max(1, Math.floor((w.config.maxCalls - w.usage.calls) / 3)));
    for (const agent of readyActors(w)) {
      if (
        agent.eco!.readyAt !== first.agent.eco!.readyAt ||
        batch.length >= limit ||
        batch.some((t) => conflicts(w, t.agent, agent))
      )
        break;
      batch.push({ kind: 'action', agent, id: ecoId(w, agent) });
    }
    return batch;
  }
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
      id: decisionIdFor(w, agent.id),
    });
  }
  return batch;
}
