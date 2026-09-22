import type { Agent, World } from '../types';

/** Grants are scoped to a door, and never count as keys for unlocking or delegation. */
export function permitted(a: Agent, door: string, key: string, time: number) {
  return (
    a.keys.includes(key) || (a.doorAccess ?? []).some((g) => g.door === door && g.until > time)
  );
}
export function allowedDoors(w: World, a: Agent) {
  return (a.doorAccess ?? []).filter((g) => g.until > w.time).map((g) => g.door);
}
export function nextAccessExpiry(w: World) {
  return Math.min(Infinity, ...w.agents.flatMap((a) => (a.doorAccess ?? []).map((g) => g.until)));
}
