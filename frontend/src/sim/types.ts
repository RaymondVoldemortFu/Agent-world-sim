import { z } from 'zod';
export type Item = 'food' | 'wood' | 'stone' | 'ore' | 'basic_tool' | 'advanced_tool';
export type Inventory = Partial<Record<Item, number>>;
const quantity = z.number().int().min(1).max(12);
const target = z.number().int().positive();
const materials = z
  .object({ wood: quantity.optional(), stone: quantity.optional(), ore: quantity.optional() })
  .strict();
const item = z.enum(['food', 'wood', 'stone', 'ore', 'basic_tool', 'advanced_tool']);
export const ActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('move'),
      dx: z.number().int().min(-1).max(1),
      dy: z.number().int().min(-1).max(1),
    })
    .strict(),
  z.object({ type: z.literal('look') }).strict(),
  z.object({ type: z.literal('harvest') }).strict(),
  z.object({ type: z.literal('terraform') }).strict(),
  z.object({ type: z.literal('wait') }).strict(),
  z
    .object({ type: z.literal('gather'), resource: z.enum(['food', 'wood', 'stone', 'ore']) })
    .strict(),
  z.object({ type: z.literal('eat'), quantity: z.number().int().min(1).max(3) }).strict(),
  z.object({ type: z.literal('take'), item, quantity }).strict(),
  z.object({ type: z.literal('drop'), item, quantity }).strict(),
  z.object({ type: z.literal('give'), targetId: target, item, quantity }).strict(),
  z.object({ type: z.literal('feed'), targetId: target }).strict(),
  z.object({ type: z.literal('attack'), targetId: target }).strict(),
  z
    .object({
      type: z.literal('chat'),
      targetId: target.optional(),
      text: z.string().min(1).max(240),
      proposal: z
        .object({ kind: z.literal('reproduce'), targetId: target })
        .strict()
        .optional(),
      acceptProposalId: z.string().max(100).optional(),
      revokeProposalId: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('experiment'),
      materials,
      method: z.enum(['combine', 'grind', 'assemble']),
    })
    .strict(),
  z.object({ type: z.literal('craft'), recipeId: z.string().max(50) }).strict(),
  z
    .object({
      type: z.literal('build'),
      recipeId: z.string().max(50),
      materials: materials.optional(),
    })
    .strict(),
  z.object({ type: z.literal('reproduce'), proposalId: z.string().max(100) }).strict(),
]);
// Explicit union keeps downstream action narrowing precise despite Zod's dynamic literal list.
export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'look' | 'harvest' | 'terraform' | 'wait' }
  | { type: 'gather'; resource: 'food' | 'wood' | 'stone' | 'ore' }
  | { type: 'eat'; quantity: number }
  | { type: 'take' | 'drop'; item: Item; quantity: number }
  | { type: 'give'; targetId: number; item: Item; quantity: number }
  | { type: 'feed' | 'attack'; targetId: number }
  | {
      type: 'chat';
      targetId?: number;
      text: string;
      proposal?: { kind: 'reproduce'; targetId: number };
      acceptProposalId?: string;
      revokeProposalId?: string;
    }
  | { type: 'experiment'; materials: Inventory; method: 'combine' | 'grind' | 'assemble' }
  | { type: 'craft'; recipeId: string }
  | { type: 'build'; recipeId: string; materials?: Inventory }
  | { type: 'reproduce'; proposalId: string };
export const DecisionSchema = z
  .object({
    intent: z.string().max(200).default(''),
    action: ActionSchema,
    memory_note: z.string().max(400).optional(),
  })
  .strict();
export type Decision = { intent: string; action: Action; memory_note?: string };
export const ReflectionSchema = z
  .object({
    summary: z.string().max(800),
    claims: z
      .array(
        z
          .object({
            content: z.string().max(300),
            sourceEventIds: z.array(z.number().int().positive()).max(20),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type Reflection = z.infer<typeof ReflectionSchema>;
export interface Memory {
  id: string;
  day: number;
  content: string;
  source: 'observed' | 'heard' | 'inferred';
  eventIds: number[];
  speakerId?: number;
  importance: number;
}
export interface Agent {
  id: number;
  name: string;
  sex: 'F' | 'M';
  age: number;
  parents: number[];
  x: number;
  y: number;
  hp: number;
  hunger: number;
  ap: number;
  inventory: Inventory;
  personality: number[];
  recipes: string[];
  intent: string;
  memories: Memory[];
  inbox: Memory[];
  claims: Memory[];
  pregnancy?: { father: number; due: number };
  cooldownUntil: number;
  death?: { day: number; cause: string };
}
export interface Tile {
  x: number;
  y: number;
  terrain: 'plain' | 'hill' | 'mountain';
  resources: Inventory;
  lastGather: number;
  farm: number;
  farmFood: number;
  ground: Inventory;
  shelter: { materials: Inventory; labor: number; complete: boolean } | null;
}
export interface Proposal {
  id: string;
  from: number;
  to: number;
  day: number;
  accepted: boolean;
  revoked: boolean;
  attempts: Record<number, number>;
  completed: boolean;
}
export interface Config {
  size: number;
  population: number;
  days: number;
  seed: number;
  spawn: 'clusters' | 'uniform';
  gestation: number;
  adultAge: number;
  populationLimit: number;
  maxCalls: number;
  maxTokens: number;
  maxMinutes: number;
  maxCost: number;
  inputPrice: number;
  outputPrice: number;
  cachePrice: number;
}
export const ConfigSchema = z
  .object({
    size: z.number().int().min(16).max(64),
    population: z.number().int().min(1).max(60),
    days: z.number().int().min(1).max(1000),
    seed: z.number().int().min(0).max(4294967295),
    spawn: z.enum(['clusters', 'uniform']),
    gestation: z.number().int().min(1).max(300),
    adultAge: z.number().int().min(1).max(1000),
    populationLimit: z.number().int().min(1).max(200),
    maxCalls: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxMinutes: z.number().positive(),
    maxCost: z.number().min(0),
    inputPrice: z.number().min(0),
    outputPrice: z.number().min(0),
    cachePrice: z.number().min(0),
  })
  .strict();
export const DEFAULT_CONFIG: Config = {
  size: 64,
  population: 20,
  days: 100,
  seed: 20260909,
  spawn: 'clusters',
  gestation: 5,
  adultAge: 20,
  populationLimit: 60,
  maxCalls: 12000,
  maxTokens: 40000000,
  maxMinutes: 720,
  maxCost: 0,
  inputPrice: 0,
  outputPrice: 0,
  cachePrice: 0,
};
export interface Metrics {
  day: number;
  alive: number;
  births: number;
  deaths: number;
  food: number;
  wildFood: number;
  farms: number;
  avgHunger: number;
  chats: number;
  gifts: number;
  attacks: number;
  experiments: number;
  discoveries: number;
  failures: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}
export interface Cursor {
  phase: 'actions' | 'reflections' | 'end' | 'complete';
  round: number;
  index: number;
  ids: number[];
}
export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  elapsedMs: number;
  errors: number;
  repairs: number;
  consecutiveErrors: number;
  estimated: boolean;
  cost: number;
  model: string;
}
export interface World {
  version: 1;
  rulesVersion: string;
  id: string;
  config: Config;
  tick: number;
  seq: number;
  nextId: number;
  rng: number;
  tiles: Tile[];
  agents: Agent[];
  proposals: Proposal[];
  cursor: Cursor;
  metrics: Metrics[];
  usage: Usage;
  counters: {
    births: number;
    deaths: number;
    chats: number;
    gifts: number;
    attacks: number;
    experiments: number;
    discoveries: number;
    failures: number;
  };
  lastEvent?: string;
}
export interface AgentChange {
  state: Omit<Agent, 'memories' | 'inbox' | 'claims'>;
  memories: { drop: number; append: Memory[] };
  inbox: { drop: number; append: Memory[] };
  claims: { drop: number; append: Memory[] };
}
export interface Patch {
  agents: Agent[];
  agentChanges?: AgentChange[];
  tiles: Tile[];
  proposals: Proposal[];
  meta: Omit<World, 'agents' | 'tiles' | 'proposals' | 'metrics'>;
  metrics?: Metrics[];
}
export interface WorldEvent {
  seq: number;
  day: number;
  round: number;
  type: string;
  actorId?: number;
  targetId?: number;
  position?: [number, number];
  text: string;
  success: boolean;
  decisionId: string;
  recipients: number[];
  patch: Patch;
}
export interface Attempt {
  promptVersion?: string;
  status: number;
  content?: string;
  error?: string;
  usage?: Record<string, number>;
  elapsedMs: number;
  model?: string;
}
export interface DecisionRecord {
  contextSource?: 'captured' | 'reconstructed-from-events';
  originalSavedContext?: unknown;
  rulesVersion?: string;
  schemaVersion?: string;
  id: string;
  runId: string;
  day: number;
  agentId: number;
  kind: 'action' | 'reflection';
  context: unknown;
  status: 'pending' | 'received' | 'committed';
  attempts: Attempt[];
  decision?: Decision;
  reflection?: Reflection;
  technicalFailure?: boolean;
  fatal?: string;
}
export interface Snapshot {
  seq: number;
  day: number;
  hash: string;
  world: World;
}
export interface Bundle {
  elapsedMs?: number;
  format: 'agent-world-v1';
  world: World;
  events: WorldEvent[];
  decisions: DecisionRecord[];
  snapshots: Snapshot[];
}
