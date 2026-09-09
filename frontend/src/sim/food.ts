import type { FoodBatch, Inventory } from './types';

export function foodSummary(batches: FoodBatch[] | undefined, day: number) {
  let fresh = 0,
    spoiled = 0;
  for (const batch of batches ?? []) {
    if (day >= batch.expiresOnDay) spoiled += batch.quantity;
    else fresh += batch.quantity;
  }
  return { fresh, spoiled };
}

export function validateFood(inventory: Inventory, batches: FoodBatch[] | undefined) {
  const lots = batches ?? [];
  if (
    lots.some(
      (b) => !Number.isInteger(b.quantity) || b.quantity <= 0 || !Number.isInteger(b.expiresOnDay),
    ) ||
    lots.reduce((n, b) => n + b.quantity, 0) !== (inventory.food ?? 0)
  )
    throw new Error('Food batch quantities do not match inventory');
}

export function mergeFood(...groups: (FoodBatch[] | undefined)[]): FoodBatch[] {
  const quantities = new Map<number, number>();
  for (const group of groups)
    for (const batch of group ?? [])
      quantities.set(
        batch.expiresOnDay,
        (quantities.get(batch.expiresOnDay) ?? 0) + batch.quantity,
      );
  return [...quantities]
    .sort(([a], [b]) => a - b)
    .map(([expiresOnDay, quantity]) => ({ expiresOnDay, quantity }));
}

// Transfers use oldest first. Eating/feeding prefer fresh food, then consume any
// spoiled remainder explicitly requested by quantity. Dates survive every move.
export function splitFood(batches: FoodBatch[] | undefined, quantity: number, day?: number) {
  const ordered = mergeFood(batches);
  if (day !== undefined)
    ordered.sort(
      (a, b) =>
        Number(a.expiresOnDay <= day) - Number(b.expiresOnDay <= day) ||
        a.expiresOnDay - b.expiresOnDay,
    );
  const taken: FoodBatch[] = [],
    remaining: FoodBatch[] = [];
  let needed = quantity;
  for (const b of ordered) {
    const n = Math.min(needed, b.quantity);
    if (n) taken.push({ ...b, quantity: n });
    if (b.quantity > n) remaining.push({ ...b, quantity: b.quantity - n });
    needed -= n;
  }
  if (needed > 0) throw new Error('Insufficient dated food');
  return { taken: mergeFood(taken), remaining: mergeFood(remaining) };
}
