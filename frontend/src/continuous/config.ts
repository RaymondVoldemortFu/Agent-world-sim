import { z } from 'zod';
import type { World } from './types';

export const ContinuousConfigSchema = z
  .object({
    days: z.number().int().min(1).max(1000).default(150),
    maxCalls: z.number().int().min(0).max(100000).default(1500),
    concurrency: z.number().int().min(1).max(8).default(5),
    contextWindow: z.number().int().min(4000).max(128000).default(100000),
    inventoryCapacity: z.number().min(5).max(100).default(15),
  })
  .strict();
export type ContinuousConfig = z.infer<typeof ContinuousConfigSchema>;
export const CONTINUOUS_DEFAULTS = ContinuousConfigSchema.parse({});
export function continuousConfig(w?: World): ContinuousConfig {
  return {
    ...CONTINUOUS_DEFAULTS,
    ...w?.settings,
    ...(w
      ? { days: w.days, maxCalls: w.maxCalls, inventoryCapacity: w.agents[0]?.capacity ?? 15 }
      : {}),
  };
}
