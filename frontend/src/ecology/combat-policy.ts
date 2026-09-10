import type { Brain } from './types';
export const fleeProbability = (hp: number) => 0.1 + (0.8 * Math.max(0, Math.min(100, hp))) / 100;
export const combatPolicy = (brain?: Brain) => ({
  mode: brain?.combatPolicy?.mode ?? 'flee',
  retreatHp: brain?.combatPolicy?.retreatHp ?? 60,
});
export const shouldFlee = (hp: number, brain?: Brain) => {
  const p = combatPolicy(brain);
  return p.mode === 'flee' || (p.mode === 'low_hp' && hp <= p.retreatHp);
};
