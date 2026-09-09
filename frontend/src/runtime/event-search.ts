import labels from '../../../shared/event-names.json';
import type { WorldEvent } from '../sim/types';

export const eventNames: Record<string, string> = labels;

export function matchesEvent(e: WorldEvent, query: string, eventType: string): boolean {
  if (eventType && e.type !== eventType) return false;
  const needle = query.trim().toLowerCase();
  const searchable = [e.text, e.type, eventNames[e.type] ?? '', e.position?.join(',') ?? '']
    .join(' ')
    .toLowerCase();
  return !needle || searchable.includes(needle);
}
