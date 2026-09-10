import type { Batch } from './types';
import { ITEMS } from './catalog';
export const mass = (b: Batch[]) => b.reduce((n, b) => n + b.kg, 0);
export const quantity = (b: Batch[], item: string) =>
  b.filter((x) => x.item === item).reduce((n, b) => n + b.kg, 0);
export const energy = (b: Batch[]) =>
  b.reduce((n, b) => n + b.kg * (ITEMS[b.item]?.kcal ?? 0) * b.quality, 0);
export function batch(
  item: string,
  kg: number,
  day: number,
  id: string,
  source: string,
  quality = 1,
  risk = 0,
): Batch {
  if (!ITEMS[item] || !Number.isFinite(kg) || kg <= 0) throw Error('无效物料');
  return {
    id,
    item,
    kg,
    created: day,
    source,
    water: ITEMS[item].moisture,
    quality,
    risk,
    ...(ITEMS[item].capabilities ? { wear: 0 } : {}),
  };
}
export function put(to: Batch[], incoming: Batch[]) {
  for (const b of incoming) {
    const old = to.find(
      (x) =>
        x.id === b.id &&
        x.item === b.item &&
        x.wear === b.wear &&
        x.quality === b.quality &&
        x.risk === b.risk,
    );
    if (old) old.kg += b.kg;
    else to.push({ ...b });
  }
}
export function take(from: Batch[], item: string, kg: number): Batch[] {
  if (!(kg > 0) || quantity(from, item) + 1e-7 < kg)
    throw Error(`缺少 ${ITEMS[item]?.name ?? item} (${kg.toFixed(2)} kg)`);
  let left = kg;
  const out: Batch[] = [];
  for (const b of [...from].sort((a, b) => a.created - b.created)) {
    if (b.item !== item || left <= 1e-8) continue;
    const n = Math.min(left, b.kg);
    out.push({ ...b, kg: n });
    b.kg -= n;
    left -= n;
  }
  for (let i = from.length - 1; i >= 0; i--) if (from[i].kg < 1e-8) from.splice(i, 1);
  return out;
}
export function requireInputs(stores: Batch[][], inputs: Record<string, number>) {
  for (const [id, n] of Object.entries(inputs))
    if (stores.reduce((s, b) => s + quantity(b, id), 0) + 1e-7 < n)
      throw Error(
        `缺少 ${ITEMS[id]?.name ?? id} ${(n - stores.reduce((s, b) => s + quantity(b, id), 0)).toFixed(2)} kg`,
      );
}
export function consume(stores: Batch[][], inputs: Record<string, number>) {
  requireInputs(stores, inputs);
  const result: Batch[] = [];
  for (const [id, n] of Object.entries(inputs)) {
    let left = n;
    for (const store of stores) {
      const q = Math.min(left, quantity(store, id));
      if (q > 1e-8) {
        put(result, take(store, id, q));
        left -= q;
      }
    }
  }
  return result;
}
export function capacity(stock: Batch[], base = 15) {
  const carriers = stock.filter(
    (b) =>
      b.kg + 1e-7 >= (ITEMS[b.item].unitKg ?? 0) &&
      (b.wear ?? 0) < (ITEMS[b.item].durability ?? 1e9) &&
      ITEMS[b.item].capacity,
  );
  return (
    base +
    Math.max(
      0,
      ...carriers.map(
        (b) => (ITEMS[b.item].capacity ?? 0) + ((ITEMS[b.item].capacity ?? 0) > 10 ? b.kg : 0),
      ),
    )
  );
}
export function capability(stores: Batch[][], name: string) {
  return Math.max(
    0,
    ...stores
      .flat()
      .filter(
        (b) =>
          b.kg + 1e-7 >= (ITEMS[b.item].unitKg ?? 0) &&
          (b.wear ?? 0) < (ITEMS[b.item]?.durability ?? 1e9),
      )
      .map((b) => ITEMS[b.item]?.capabilities?.[name] ?? 0),
  );
}
export function wear(stores: Batch[][], name: string, minutes: number) {
  const b = stores
    .flat()
    .filter(
      (b) =>
        (b.wear ?? 0) < (ITEMS[b.item]?.durability ?? 1e9) &&
        (ITEMS[b.item]?.capabilities?.[name] ?? 0) > 0,
    )
    .sort((a, b) => ITEMS[b.item].capabilities![name] - ITEMS[a.item].capabilities![name])[0];
  if (b) b.wear = (b.wear ?? 0) + minutes;
}
/** Decay removes material. Risk rises independently of retained calories. */
export function spoil(stock: Batch[], temperature: number, protectedStorage = false) {
  let lost = 0;
  for (const b of stock) {
    const d = ITEMS[b.item];
    if (!d?.kcal) continue;
    const heat = Math.max(0.1, Math.pow(2, (temperature - 15) / 10));
    const dry = b.water < 0.2;
    const rate = dry
      ? (protectedStorage ? 1 - Math.pow(0.94, 1 / 180) : 1 - Math.pow(0.75, 1 / 180)) * heat
      : (0.02 * heat) / d.life;
    const n = b.kg * rate;
    b.kg -= n;
    lost += n;
    b.risk = Math.min(
      1,
      b.risk + (heat / d.life) * (dry ? 0.006 : 0.18) * (protectedStorage ? 0.6 : 1),
    );
    b.quality = Math.max(0.15, b.quality - (dry ? 0.00005 : 0.002) * heat);
  }
  return lost;
}
