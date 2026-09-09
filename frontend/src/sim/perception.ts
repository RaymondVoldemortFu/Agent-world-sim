import type { Agent, CorpseView, SurveyResult, World } from './types';
import { foodSummary } from './food';
import { adult } from './world';

export const SURVEY_AP = 2;
export const SURVEY_RADIUS = 3;
const inRange = (a: { x: number; y: number }, b: { x: number; y: number }, radius: number) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= radius;

export function visibleCorpses(w: World, a: { x: number; y: number }, radius = 1): CorpseView[] {
  return w.agents
    .filter((b) => b.death && b.corpse && inRange(a, b.corpse, radius))
    .map((b) => ({ id: b.id, name: b.name, x: b.corpse!.x, y: b.corpse!.y, status: 'dead' }));
}

export function surveyArea(w: World, a: Agent): SurveyResult {
  return structuredClone({
    day: w.tick,
    eventSeq: w.seq + 1,
    origin: [a.x, a.y],
    radius: SURVEY_RADIUS,
    tiles: w.tiles
      .filter((t) => inRange(a, t, SURVEY_RADIUS))
      .map((t) => ({
        x: t.x,
        y: t.y,
        terrain: t.terrain,
        resources: t.resources,
        ...(Object.keys(t.ground).length
          ? {
              ground: t.ground,
              freshFood: foodSummary(t.groundFoodBatches, w.tick).fresh,
              spoiledFood: foodSummary(t.groundFoodBatches, w.tick).spoiled,
            }
          : {}),
        ...(t.farm ? { farm: t.farm, farmFood: t.farmFood } : {}),
        ...(t.shelter
          ? { shelter: t.shelter.complete ? ('complete' as const) : ('building' as const) }
          : {}),
      })),
    people: w.agents
      .filter((b) => !b.death && b.id !== a.id && inRange(a, b, SURVEY_RADIUS))
      .map((b) => ({
        id: b.id,
        name: b.name,
        sex: b.sex,
        ageStage: adult(w, b) ? ('adult' as const) : ('child' as const),
        x: b.x,
        y: b.y,
        status: 'alive' as const,
        ...(b.role ? { role: b.role } : {}),
        health: b.hp > 60 ? '正常' : b.hp > 20 ? '受伤' : '濒危',
      })),
    corpses: visibleCorpses(w, a, SURVEY_RADIUS),
  });
}
