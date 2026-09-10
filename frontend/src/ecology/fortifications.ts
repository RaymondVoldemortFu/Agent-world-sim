import type { World } from '../sim/types';
import type { Tx } from '../sim/transaction';
import { BUILDINGS } from './catalog';
import { ecoAt } from './world';

export function strongestWall(w: World, region: number, x: number, y: number) {
  return ecoAt(w, x, y, region)
    .eco!.structures.filter(
      (s) => BUILDINGS[s.kind]?.wall && s.progress >= BUILDINGS[s.kind].minutes && s.condition > 0,
    )
    .sort(
      (a, b) =>
        BUILDINGS[b.kind].wall!.tier - BUILDINGS[a.kind].wall!.tier || b.condition - a.condition,
    )[0];
}
export function strikeWall(w: World, tx: Tx, region: number, x: number, y: number, damage: number) {
  const wall = strongestWall(w, region, x, y);
  if (!wall) return { remaining: damage, message: '' };
  const def = BUILDINGS[wall.kind];
  const hp = wall.condition * def.wall!.durability;
  const absorbed = Math.min(hp, damage);
  tx.t(x, y, region);
  wall.condition = Math.max(0, (hp - absorbed) / def.wall!.durability);
  return {
    remaining: damage - absorbed,
    message: `${def.name} ${wall.id} 承受${absorbed.toFixed(0)}伤害${wall.condition === 0 ? '，围墙被攻破' : ''}`,
  };
}
