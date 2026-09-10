import type { EcoObservation } from '../ecology/types';
import { BUILDINGS } from '../ecology/catalog';
import { capability } from '../ecology/batches';

/** Shortest cardinal path over observed terrain; unknown cells are explored optimistically. */
export function navigate(o: EcoObservation, x: number, y: number) {
  const size = o.policy.mapSize,
    [sx, sy] = o.self.position;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size)
    return { status: 'blocked' as const, reason: '导航坐标超出本区域边界' };
  if (sx === x && sy === y) return { status: 'arrived' as const, steps: 0 };
  const known = new Map(
    o.self.brain.places
      .filter((p) => p.region === o.self.body.region)
      .map((p) => [`${p.x},${p.y}`, { biome: p.biome, bridge: p.bridge }]),
  );
  for (const t of o.tiles)
    known.set(`${t.x},${t.y}`, {
      biome: t.eco.biome,
      bridge: t.eco.structures.some(
        (s) => s.kind === 'bridge' && s.progress >= BUILDINGS.bridge.minutes && s.condition > 0.4,
      ),
    });
  const boat = capability([o.self.body.stock], 'boat') > 0;
  const beasts = o.beasts ?? [];
  const dangerDistance = (x: number, y: number) =>
    Math.min(Infinity, ...beasts.map((b) => Math.max(Math.abs(x - b.x), Math.abs(y - b.y))));
  const queue = [{ x: sx, y: sy, steps: 0, dx: 0, dy: 0 }],
    seen = new Set([`${sx},${sy}`]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.x === x && p.y === y)
      return {
        status: 'moving' as const,
        steps: p.steps,
        action: { type: 'move' as const, dx: p.dx, dy: p.dy },
      };
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = p.x + dx,
        ny = p.y + dy,
        key = `${nx},${ny}`,
        terrain = known.get(key);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || seen.has(key)) continue;
      if (terrain?.biome === 'water' && !boat && !terrain.bridge) continue;
      const danger = dangerDistance(nx, ny),
        previous = dangerDistance(p.x, p.y);
      if (danger === 0 || (danger <= 1 && (previous > 1 || danger < previous))) continue;
      seen.add(key);
      queue.push({
        x: nx,
        y: ny,
        steps: p.steps + 1,
        dx: p.steps ? p.dx : dx,
        dy: p.steps ? p.dy : dy,
      });
    }
  }
  return {
    status: 'blocked' as const,
    reason: '已知地形或当前兽群阻断路线，需要调整目的地、工具或等待',
  };
}
