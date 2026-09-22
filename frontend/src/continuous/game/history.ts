import { mergeMail, type Event, type World } from '../types';

/** Immutable committed frames share unchanged rows and static map data. */
export function eventFrame(world: World, event: Event): World {
  const patch = structuredClone(event.patch);
  const next = { ...world, ...patch.meta, seq: event.seq, time: event.time };
  for (const key of ['agents', 'stores', 'fields', 'gates'] as const) {
    const updates = patch[key];
    if (!updates?.length) continue;
    const changed = new Map<string | number, unknown>(updates.map((row) => [row.id, row]));
    const rows = world[key].map((row) => {
      const updated = changed.get(row.id);
      changed.delete(row.id);
      return updated ?? row;
    });
    (next as unknown as Record<string, unknown>)[key] = [...rows, ...changed.values()];
  }
  if (next.manor && (patch.mail?.length || patch.meta.manor)) {
    next.manor = { ...next.manor };
    mergeMail(next, patch, world.manor?.letters);
  }
  return next;
}

export function mergeEvents(old: Event[], incoming: Event[], limit = 500) {
  const rows = new Map(old.map((e) => [e.seq, e]));
  for (const event of incoming) rows.set(event.seq, event);
  return [...rows.values()].sort((a, b) => a.seq - b.seq).slice(-limit);
}
