import type { World } from '../sim/types';
import type { Batch, Inscription } from '../ecology/types';
import { inscriptionRecords } from '../ecology/inscriptions';
import { BUILDINGS, ITEMS } from '../ecology/catalog';

export interface InscriptionLocation {
  key: string;
  kind: 'ground' | 'bag' | 'storage';
  region: number;
  x: number;
  y: number;
  label: string;
  kg: number;
  readable: boolean;
}
export interface InscriptionEntry {
  record: Inscription;
  item: string;
  locations: InscriptionLocation[];
}

/** Read only the selected replay snapshot; do not scan action logs or expose data to Agents. */
export function worldInscriptions(w?: World): InscriptionEntry[] {
  if (!w?.ecology) return [];
  const records = new Map<string, InscriptionEntry>();
  const add = (batches: Batch[], location: Omit<InscriptionLocation, 'kg' | 'readable'>) => {
    for (const batch of batches) {
      if (!(batch.kg > 0)) continue;
      for (const record of inscriptionRecords(batch)) {
        let entry = records.get(record.id);
        if (!entry) {
          entry = { record, item: batch.item, locations: [] };
          records.set(record.id, entry);
        }
        const readable =
          batch.kg + 1e-7 >=
          (ITEMS[batch.item]?.unitKg ?? (batch.item === 'inscribed_stone' ? 2 : 1));
        const existing = entry.locations.find((p) => p.key === location.key);
        if (existing) {
          existing.kg += batch.kg;
          existing.readable ||= readable;
        } else entry.locations.push({ ...location, kg: batch.kg, readable });
      }
    }
  };
  for (const t of w.tiles) {
    if (!t.eco) continue;
    const point = { region: t.eco.region, x: t.x, y: t.y };
    add(t.eco.ground, {
      ...point,
      key: `ground:${point.region}:${t.x}:${t.y}`,
      kind: 'ground',
      label: '地面',
    });
    for (const s of t.eco.structures)
      add(s.contents, {
        ...point,
        key: `storage:${point.region}:${t.x}:${t.y}:${s.id}`,
        kind: 'storage',
        label: `${BUILDINGS[s.kind]?.name ?? s.kind} · ${s.id}`,
      });
  }
  for (const a of w.agents) {
    if (!a.eco) continue;
    add(a.eco.stock, {
      region: a.eco.region,
      x: a.x,
      y: a.y,
      key: `bag:${a.id}`,
      kind: 'bag',
      label: `${a.name} #${a.id} 的背包${a.death ? '（已死亡）' : ''}`,
    });
  }
  return [...records.values()].sort(
    (a, b) =>
      b.record.day - a.record.day ||
      b.record.eventSeq - a.record.eventSeq ||
      a.record.id.localeCompare(b.record.id),
  );
}
