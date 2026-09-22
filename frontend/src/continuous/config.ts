import { z } from 'zod';
import type { World } from './types';

const ConfigFields = z
  .object({
    scenario: z.enum(['elmwick', 'manor']).default('manor'),
    taxRate: z.number().min(0).max(1).default(0.5),
    royalTax: z.number().min(0).max(10000).default(450),
    shockDay: z.number().int().min(0).max(1000).default(40),
    yieldMultiplier: z.number().min(0).max(2).default(0.5),
    graceDays: z.number().int().min(1).max(100).default(7),
    armySize: z.number().int().min(1).max(50).default(10),
    days: z.number().int().min(1).max(1000).default(150),
    concurrency: z.number().int().min(1).max(8).default(5),
    contextWindow: z.number().int().min(4000).max(128000).default(100000),
    inventoryCapacity: z.number().min(5).max(100).default(30),
  })
  .strict();
// Old saved configurations may contain retired request/token budgets.
export const ContinuousConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const { maxCalls, maxTokens, ...config } = raw as Record<string, unknown>;
  return config;
}, ConfigFields);
export type ContinuousConfig = z.infer<typeof ContinuousConfigSchema>;
export const CONTINUOUS_DEFAULTS = ContinuousConfigSchema.parse({});
export function continuousConfig(w?: World): ContinuousConfig {
  return ContinuousConfigSchema.parse({
    ...CONTINUOUS_DEFAULTS,
    ...w?.settings,
    ...(w ? { scenario: w.manor ? ('manor' as const) : ('elmwick' as const) } : {}),
    ...(w ? { days: w.days, inventoryCapacity: w.agents[0]?.capacity ?? 15 } : {}),
  });
}
