import { TILE, type Point, type World, type Site } from '../types';

export type Solid = { x: number; y: number; w: number; d: number };
export type Building = Solid & { id: string; kind: Site['kind']; height: number; door: number };
export type WallSegment = { a: Point; b: Point };
export function buildings(w: World): Building[] {
  return w.sites
    .filter((s) => ['home', 'hall', 'workshop'].includes(s.kind))
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      x: s.x,
      y: s.y,
      w: s.kind === 'hall' ? 24 : s.kind === 'workshop' ? 18 : 15,
      d: s.kind === 'hall' ? 18 : 12,
      height: s.kind === 'hall' ? 12 : s.kind === 'workshop' ? 6 : 7.5,
      door: 3.6,
    }));
}
export function wallSegments(w: World): WallSegment[] {
  const segments: WallSegment[] = [];
  for (const a of w.walls) {
    for (const b of w.walls)
      if ((b.x === a.x && b.y === a.y + TILE) || (b.y === a.y && b.x === a.x + TILE))
        segments.push({ a, b });
    for (const g of w.gates)
      if (Math.abs(Math.hypot(a.x - g.x, a.y - g.y) - TILE) < 0.01) {
        const d = Math.hypot(a.x - g.x, a.y - g.y);
        segments.push({
          a,
          b: { x: g.x + ((a.x - g.x) / d) * 3.5, y: g.y + ((a.y - g.y) / d) * 3.5 },
        });
      }
  }
  return segments;
}
export function solids(w: World, keys: string[], doors: string[] = []): Solid[] {
  const list: Solid[] = [];
  for (const well of w.sites.filter((s) => s.kind === 'well'))
    list.push({ x: well.x, y: well.y, w: 4.5, d: 4.5 });
  for (const b of buildings(w)) {
    // Interior destinations are accessible only through the south-facing doorway.
    list.push(
      { x: b.x - b.w / 2, y: b.y, w: 1, d: b.d },
      { x: b.x + b.w / 2, y: b.y, w: 1, d: b.d },
      { x: b.x, y: b.y - b.d / 2, w: b.w, d: 1 },
    );
    const lock = w.stores.find((s) => s.id === b.id)?.lock;
    if (lock?.locked && lock.hp > 0 && !keys.includes(lock.key) && !doors.includes(b.id))
      list.push({ x: b.x, y: b.y + b.d / 2, w: b.door, d: 1 });
    const wing = (b.w - b.door) / 2;
    for (const sign of [-1, 1])
      list.push({ x: b.x + sign * (b.door / 2 + wing / 2), y: b.y + b.d / 2, w: wing, d: 1 });
  }
  for (const { a, b } of wallSegments(w))
    list.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      w: Math.abs(a.x - b.x) + 1.5,
      d: Math.abs(a.y - b.y) + 1.5,
    });
  for (const g of w.gates)
    if (!g.open && !keys.includes(g.key) && !doors.includes(g.id))
      list.push({ x: g.x, y: g.y, w: 1.5, d: 7 });
  return list;
}
export const CLEARANCE = 0.55;
export function collides(p: Point, list: Solid[], clearance = CLEARANCE) {
  return list.some(
    (s) => Math.abs(p.x - s.x) < s.w / 2 + clearance && Math.abs(p.y - s.y) < s.d / 2 + clearance,
  );
}
/** Segment slab intersection, including clearance around the resident's capsule. */
export function segmentClear(a: Point, b: Point, list: Solid[]) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const s of list) {
    const minX = s.x - s.w / 2 - CLEARANCE,
      maxX = s.x + s.w / 2 + CLEARANCE;
    const minY = s.y - s.d / 2 - CLEARANCE,
      maxY = s.y + s.d / 2 + CLEARANCE;
    if (
      Math.max(a.x, b.x) < minX ||
      Math.min(a.x, b.x) > maxX ||
      Math.max(a.y, b.y) < minY ||
      Math.min(a.y, b.y) > maxY
    )
      continue;
    let lo = 0,
      hi = 1;
    if (Math.abs(dx) < 1e-10) {
      if (a.x < minX || a.x > maxX) continue;
    } else {
      const t0 = (minX - a.x) / dx,
        t1 = (maxX - a.x) / dx;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) continue;
    }
    if (Math.abs(dy) < 1e-10) {
      if (a.y < minY || a.y > maxY) continue;
    } else {
      const t0 = (minY - a.y) / dy,
        t1 = (maxY - a.y) / dy;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) continue;
    }
    return false;
  }
  return true;
}

export function interactionPoint(w: World, p: Point): Point {
  if (
    w.version === 'continuous-game-2' &&
    w.sites.some((s) => s.kind === 'well' && s.x === p.x && s.y === p.y)
  )
    return { x: p.x, y: p.y + 3.8 };
  return p;
}
