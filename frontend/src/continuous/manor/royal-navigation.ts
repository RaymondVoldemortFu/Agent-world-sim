import { permitted } from './access';
import { TILE, position, type World, type Agent, type Task, type Point } from '../types';
import { route } from '../game/navigation';
import { buildings, CLEARANCE, type Solid } from '../game/space';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Persist stable, balanced assignments using authoritative positions, irrespective of sight. */
export function assignRoyalTargets(w: World): Map<number, Agent> {
  const result = new Map<number, Agent>();
  if (!w.manor) return result;
  const outsiders = new Set(w.manor.missions.map((m) => m.agentId));
  const people = new Map(w.agents.filter((a) => !a.dead && !a.away).map((a) => [a.id, a]));
  const targets = [...people.values()].filter((a) => !outsiders.has(a.id));
  const soldiers = w.manor.missions
    .filter((m) => m.kind === 'army' && people.has(m.agentId))
    .sort((a, b) => a.agentId - b.agentId);
  const counts = new Map(targets.map((a) => [a.id, 0]));
  // Keep one existing pursuer per victim first; old duplicate assignments get redistributed.
  for (const m of soldiers) {
    if (m.targetId !== undefined && counts.get(m.targetId) === 0) {
      counts.set(m.targetId, 1);
      result.set(m.agentId, people.get(m.targetId)!);
    }
  }
  for (const m of soldiers) {
    if (result.has(m.agentId)) continue;
    const from = position(people.get(m.agentId)!, w.time);
    const target = [...targets].sort(
      (a, b) =>
        counts.get(a.id)! - counts.get(b.id)! ||
        distance(from, position(a, w.time)) - distance(from, position(b, w.time)) ||
        a.id - b.id,
    )[0];
    if (target) {
      counts.set(target.id, counts.get(target.id)! + 1);
      result.set(m.agentId, target);
    }
  }
  for (const m of soldiers) {
    const target = result.get(m.agentId);
    if (target) m.targetId = target.id;
    else delete m.targetId;
  }
  return result;
}

/** Entry distance along a segment, including the same capsule clearance as navigation. */
function entry(a: Point, b: Point, s: Solid): number | undefined {
  let lo = 0,
    hi = 1;
  for (const [start, delta, center, half] of [
    [a.x, b.x - a.x, s.x, s.w / 2 + CLEARANCE],
    [a.y, b.y - a.y, s.y, s.d / 2 + CLEARANCE],
  ]) {
    if (Math.abs(delta) < 1e-10) {
      if (start < center - half || start > center + half) return;
    } else {
      const p = (center - half - start) / delta,
        q = (center + half - start) / delta;
      lo = Math.max(lo, Math.min(p, q));
      hi = Math.min(hi, Math.max(p, q));
      if (lo > hi) return;
    }
  }
  return lo;
}

/** Find the first locked door on a route to this victim, keeping all permanent walls solid. */
export function royalTargetTask(w: World, soldier: Agent, victim: Agent): Task | undefined {
  const target = position(victim, w.time);
  if (route(w, soldier, target)) return { kind: 'attack', target: `agent:${victim.id}`, amount: 1 };
  return blockedDoorTask(w, soldier, target);
}

export function blockedDoorTask(w: World, soldier: Agent, target: Point): Task | undefined {
  const doors: (Solid & { id: string; key: string })[] = [];
  for (const gate of w.gates)
    if (!gate.open && !permitted(soldier, gate.id, gate.key, w.time))
      doors.push({ ...gate, w: 1.5, d: 7 });
  for (const b of buildings(w)) {
    const lock = w.stores.find((s) => s.id === b.id)?.lock;
    if (lock?.locked && lock.hp > 0 && !permitted(soldier, b.id, lock.key, w.time))
      doors.push({ id: b.id, key: lock.key, x: b.x, y: b.y + b.d / 2, w: b.door, d: 1 });
  }
  if (!doors.length) return;
  // Keys are hypothetical only for route analysis. The real soldier never receives them.
  const path = route(
    w,
    { ...soldier, keys: [...soldier.keys, ...doors.map((d) => d.key)] },
    target,
  );
  if (!path) return;
  for (let i = 1; i < path.length; i++) {
    const hit = doors
      .map((door) => ({ door, t: entry(path[i - 1], path[i], door) }))
      .filter((hit): hit is { door: (typeof doors)[number]; t: number } => hit.t !== undefined)
      .sort((a, b) => a.t - b.t || a.door.id.localeCompare(b.door.id))[0];
    if (hit) return { kind: 'break_lock', target: hit.door.id, amount: 1 };
  }
}

export function navigationFailure(w: World, a: Agent, target: Point, id: string): string {
  if (
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    target.x < 0 ||
    target.y < 0 ||
    target.x >= w.size.w * TILE ||
    target.y >= w.size.h * TILE
  )
    return `coordinate_error：坐标错误 ${id}；坐标需在地图米制边界内`;
  const door = blockedDoorTask(w, a, target);
  if (door)
    return `door_locked：门锁了无法进入，阻碍是 ${door.target}；可索取钥匙、请求开门，或 task.kind=break_lock,target=${door.target} 暴力破门（一次一击，可重复直到耐久为0）`;
  return `route_not_found：路线不存在 ${id}；固定墙体或建筑障碍阻挡，请更换目标或可通行坐标。若门锁阻路可使用 break_lock`;
}
