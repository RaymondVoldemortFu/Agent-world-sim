import { createManorWorld } from '../manor/world';
import { createContinuousWorld } from '../world';
import type { World } from '../types';
import type { ContinuousConfig } from '../config';
export function createGameWorld(
  id: string,
  mode: World['mode'] = 'scripted',
  config: Partial<ContinuousConfig> = {},
) {
  if (config.scenario === 'manor') return createManorWorld(id, mode, config);
  const w = createContinuousWorld(id, mode, config.days ?? 150, config);
  w.version = 'continuous-game-2';
  const plaza = w.sites.find((s) => s.id === 'plaza')!;
  w.agents.forEach((a, i) => {
    a.x = plaza.x + (i - 2) * 2.6;
    a.y = plaza.y + 3 + (i % 2) * 2;
  });
  return w;
}
