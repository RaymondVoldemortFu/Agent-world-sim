import type { Agent } from './types';

export const SOCIAL_RULES = {
  silentDaysBeforeIncrease: 2,
  lonelinessPerDay: 20,
  reliefPerConversation: 20,
  depressionDamagePerDay: 10,
  minCapacity: 40,
  maxCapacity: 100,
} as const;

export function lonelinessCapacity(a: Agent): number {
  return Math.round(
    SOCIAL_RULES.maxCapacity -
      (SOCIAL_RULES.maxCapacity - SOCIAL_RULES.minCapacity) * a.personality[2],
  );
}

export function recordSpeaking(a: Agent, day: number) {
  if (!a.social) return;
  a.social.lastSpokeDay = day;
  a.social.loneliness = Math.max(0, a.social.loneliness - SOCIAL_RULES.reliefPerConversation);
  if (a.social.loneliness === 0) a.social.depressed = false;
}
