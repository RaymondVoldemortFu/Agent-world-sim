import { hasCart } from '../manor/rules';
import { SPEED, body, type World, type Agent } from '../types';
/** Scene pacing is expressed in wall seconds, then committed on the canonical game clock. */
export function movementSpeed(w: World, a: Agent) {
  const base = w.version === 'continuous-game-2' ? 15 / SPEED : 1.2;
  return (base / (1 + (hasCart(a) ? 0 : a.grain / 30))) * Math.max(0.35, body(a, w.time).hp / 100);
}
export function actionDuration(w: World, kind: string, original: number) {
  if (w.version === 'continuous-prototype-1' || ['walk', 'wait', 'work', 'rest'].includes(kind))
    return Math.max(100, original);
  const minimum = kind === 'speech' ? 3 : kind === 'eat' ? 2.5 : 2;
  return Math.max(original, minimum * 1000 * SPEED);
}
