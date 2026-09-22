import { SPEED, type World } from '../types';
export type Frame = { world: World; at: number };
/** Render committed history 350 ms behind reception; no prediction beyond the durable head. */
export function present(
  frames: Frame[],
  now: number,
  replay?: World,
): { world: World; time: number } | undefined {
  if (replay) return { world: replay, time: replay.time };
  const latest = frames.at(-1);
  if (!latest) return;
  if (latest.world.status !== 'running') return { world: latest.world, time: latest.world.time };
  const time = Math.max(
    0,
    Math.min(latest.world.time, latest.world.time + (now - latest.at - 350) * SPEED),
  );
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].world.time <= time) lo = mid + 1;
    else hi = mid;
  }
  const state = frames[Math.max(0, lo - 1)].world;
  return { world: state, time: Math.max(state.time, time) };
}
