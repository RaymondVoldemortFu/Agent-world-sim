import { allowedDoors, permitted } from '../manor/access';
import { TILE, position, type World, type Agent, type Point } from '../types';
import { solids, collides, segmentClear, interactionPoint } from './space';
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cell = (p: Point) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`;
/** Four-connected paths have continuous positions and cannot cut wall corners. */
export function legacyRoute(w: World, a: Agent, target: Point): Point[] | undefined {
  const from = position(a, w.time);
  const blocked = new Set(w.walls.map(cell));
  for (const g of w.gates) if (!g.open && !permitted(a, g.id, g.key, w.time)) blocked.add(cell(g));
  const start = { x: Math.floor(from.x / TILE), y: Math.floor(from.y / TILE) };
  const goal = { x: Math.floor(target.x / TILE), y: Math.floor(target.y / TILE) };
  if (goal.x < 0 || goal.y < 0 || goal.x >= w.size.w || goal.y >= w.size.h) return;
  const key = (x: number, y: number) => `${x},${y}`;
  if (blocked.has(key(goal.x, goal.y))) return;
  const q = [start],
    parent = new Map<string, string>();
  parent.set(key(start.x, start.y), '');
  for (let index = 0; index < q.length; index++) {
    const p = q[index];
    if (p.x === goal.x && p.y === goal.y) {
      const path: Point[] = [];
      let k = key(p.x, p.y);
      while (k) {
        const [x, y] = k.split(',').map(Number);
        path.unshift({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
        k = parent.get(k)!;
      }
      // Return to the current cell's center before turning, preventing corner cutting
      // when a route is replaced midway along an edge.
      if (dist(from, path[0]) > 0.001) path.unshift(from);
      else path[0] = from;
      if (dist(path.at(-1)!, target) > 0.001) path.push(target);
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const x = p.x + dx,
        y = p.y + dy,
        k = key(x, y);
      if (x < 0 || y < 0 || x >= w.size.w || y >= w.size.h || blocked.has(k) || parent.has(k))
        continue;
      parent.set(k, key(p.x, p.y));
      q.push({ x, y });
    }
  }
}

const directions = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;
const reverseDirection = [2, 3, 0, 1, 7, 6, 5, 4];
// Cache collision results only, never paths or mutable agent state. Geometry encodes doors/keys/locks.
const edgeCaches = new WeakMap<World, Map<string, Uint8Array>>();
function collisionEdges(
  w: World,
  obstacles: ReturnType<typeof solids>,
  width: number,
  height: number,
) {
  let cache = edgeCaches.get(w);
  if (!cache) {
    cache = new Map();
    edgeCaches.set(w, cache);
  }
  const key = JSON.stringify([width, height, obstacles]);
  let edges = cache.get(key);
  if (!edges) {
    edges = new Uint8Array(width * height * 8);
    if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  } else cache.delete(key);
  cache.set(key, edges);
  return edges;
}

/** Deterministic A* on a 1.5m clearance grid, followed by collision-tested string pulling. */
export function route(w: World, a: Agent, target: Point): Point[] | undefined {
  if (w.version === 'continuous-prototype-1') return legacyRoute(w, a, target);
  target = interactionPoint(w, target);
  const from = position(a, w.time),
    obstacles = solids(w, a.keys, allowedDoors(w, a)),
    step = 1.5;
  if (
    target.x < 0 ||
    target.y < 0 ||
    target.x >= w.size.w * TILE ||
    target.y >= w.size.h * TILE ||
    collides(target, obstacles) ||
    collides(from, obstacles)
  )
    return;
  if (segmentClear(from, target, obstacles)) return [from, { x: target.x, y: target.y }];
  const width = Math.floor((w.size.w * TILE) / step),
    height = Math.floor((w.size.h * TILE) / step);
  const point = (i: number) => ({
    x: ((i % width) + 0.5) * step,
    y: (Math.floor(i / width) + 0.5) * step,
  });
  const near = (p: Point) => {
    const x = Math.floor(p.x / step),
      y = Math.floor(p.y / step),
      candidates = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) {
          const id = (y + dy) * width + x + dx,
            q = point(id);
          if (!collides(q, obstacles) && segmentClear(p, q, obstacles)) candidates.push(id);
        }
    return candidates.sort((a, b) => dist(p, point(a)) - dist(p, point(b)))[0];
  };
  const start = near(from),
    goal = near(target);
  if (start === undefined || goal === undefined) return;
  const edges = collisionEdges(w, obstacles, width, height);
  const costs = new Float64Array(width * height).fill(Infinity),
    parent = new Int32Array(width * height).fill(-1),
    closed = new Uint8Array(width * height);
  const heap: { id: number; f: number }[] = [];
  const push = (id: number, f: number) => {
    let i = heap.length;
    heap.push({ id, f });
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= f) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = { id, f };
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      heap[0] = last;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++;
        if (heap[c].f >= last.f) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return first.id;
  };
  costs[start] = 0;
  push(start, dist(point(start), target));
  while (heap.length) {
    const id = pop();
    if (closed[id]) continue;
    closed[id] = 1;
    if (id === goal) {
      const raw = [{ x: target.x, y: target.y }];
      let n = id;
      while (n !== -1) {
        raw.unshift(point(n));
        n = parent[n];
      }
      raw.unshift(from);
      const path = [from];
      let i = 0;
      while (i < raw.length - 1) {
        let j = raw.length - 1;
        while (j > i + 1 && !segmentClear(raw[i], raw[j], obstacles)) j--;
        path.push(raw[j]);
        i = j;
      }
      return path;
    }
    const p = point(id),
      x = id % width,
      y = Math.floor(id / width);
    for (let direction = 0; direction < directions.length; direction++) {
      const [dx, dy] = directions[direction];
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      const q = point(ni),
        cost = costs[id] + dist(p, q);
      if (cost >= costs[ni]) continue;
      const edge = id * 8 + direction;
      if (!edges[edge]) {
        const passable = segmentClear(p, q, obstacles) ? 2 : 1;
        edges[edge] = passable;
        edges[ni * 8 + reverseDirection[direction]] = passable;
      }
      if (edges[edge] === 1) continue;
      costs[ni] = cost;
      parent[ni] = id;
      push(ni, cost + dist(q, target));
    }
  }
}
