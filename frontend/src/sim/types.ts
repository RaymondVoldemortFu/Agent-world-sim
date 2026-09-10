import { z } from 'zod';
import {
  EcoActionSchema,
  type EcoAction,
  type Ecology,
  type EcoBody,
  type EcoTile,
  type Brain,
  type BrainUpdate,
} from '../ecology/types';
export type Item = 'food' | 'wood' | 'stone' | 'ore' | 'basic_tool' | 'advanced_tool';
export type Inventory = Partial<Record<Item, number>>;
export interface FoodBatch {
  quantity: number;
  expiresOnDay: number;
}
const quantity = z.number().int().min(1).max(15);
const target = z.number().int().positive();
const materials = z
  .object({ wood: quantity.optional(), stone: quantity.optional(), ore: quantity.optional() })
  .strict();
const item = z.enum(['food', 'wood', 'stone', 'ore', 'basic_tool', 'advanced_tool']);
export const ActionSchema = z
  .discriminatedUnion('type', [
    EcoActionSchema,
    z
      .object({
        type: z.literal('move'),
        dx: z.number().int().min(-1).max(1),
        dy: z.number().int().min(-1).max(1),
      })
      .strict(),
    z.object({ type: z.literal('shout'), text: z.string().min(1).max(240) }).strict(),
    z.object({ type: z.literal('public_speak'), text: z.string().min(1).max(240) }).strict(),
    z.object({ type: z.literal('survey') }).strict(),
    z.object({ type: z.literal('harvest') }).strict(),
    z.object({ type: z.literal('terraform') }).strict(),
    z.object({ type: z.literal('wait') }).strict(),
    z
      .object({ type: z.literal('gather'), resource: z.enum(['food', 'wood', 'stone', 'ore']) })
      .strict(),
    z.object({ type: z.literal('eat'), quantity: z.number().int().min(1).max(3) }).strict(),
    z.object({ type: z.literal('take'), item, quantity }).strict(),
    z.object({ type: z.literal('drop'), item, quantity }).strict(),
    z.object({ type: z.literal('place'), item, quantity }).strict(),
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
  ])
  .superRefine((action, ctx) => {
    if (
      action.type === 'chat' &&
      [action.proposal, action.acceptProposalId, action.revokeProposalId].filter(
        (value) => value !== undefined,
      ).length > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'proposal（新建）、acceptProposalId（接受）、revokeProposalId（撤回）只能填写一个；接受已有提案时只填 acceptProposalId 和聊天内容',
      });
    }
  });
// Explicit union keeps downstream action narrowing precise despite Zod's dynamic literal list.
export type Action =
  | EcoAction
  | { type: 'move'; dx: number; dy: number }
  | { type: 'harvest' | 'terraform' | 'wait' | 'survey' }
  | { type: 'shout' | 'public_speak'; text: string }
  | { type: 'gather'; resource: 'food' | 'wood' | 'stone' | 'ore' }
  | { type: 'eat'; quantity: number }
  | { type: 'take' | 'drop' | 'place'; item: Item; quantity: number }
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
export type Decision = {
  intent: string;
  action: Action;
  memory_note?: string;
  brainUpdate?: BrainUpdate;
};
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
  eco?: EcoBody;
  brain?: Brain;
  id: number;
  name: string;
  role?: 'prophet';
  sex: 'F' | 'M';
  age: number;
  parents: number[];
  x: number;
  y: number;
  hp: number;
  hunger: number;
  social?: { loneliness: number; lastSpokeDay: number; depressed: boolean };
  ap: number;
  inventory: Inventory;
  foodBatches?: FoodBatch[];
  personality: number[];
  recipes: string[];
  intent: string;
  memories: Memory[];
  inbox: Memory[];
  claims: Memory[];
  pregnancy?: { father: number; due: number };
  cooldownUntil: number;
  death?: { day: number; cause: string };
  corpse?: { x: number; y: number; sinceDay: number };
  survey?: SurveyResult;
}
export interface Tile {
  eco?: EcoTile;
  x: number;
  y: number;
  terrain: 'plain' | 'hill' | 'mountain';
  resources: Inventory;
  lastGather: number;
  farm: number;
  farmFood: number;
  ground: Inventory;
  groundFoodBatches?: FoodBatch[];
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
  worldModel: 'legacy' | 'ecology';
  controller: 'atomic' | 'hybrid';
  ecoPreset: 'forager' | 'settlement' | 'village';
  startDay: number;
  regions: number;
  llmDailyCalls: number;
  llmDailyTokens: number;
  contextWindow?: number;
  size: number;
  population: number;
  days: number;
  seed: number;
  spawn: 'clusters' | 'uniform' | 'compact';
  wildlifeEnabled: boolean;
  beastRespawnDays?: number;
  beastPowerMultiplier?: number;
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
  plainFoodCapacity: number;
  plainRecoveryDays: number;
  foodShelfLifeDays: number;
  inventoryCapacity: number;
  spoiledFoodDamage: number;
  spoiledFoodHungerGain: number;
  dailyAP: number;
  freeDrop: boolean;
  reproductionSuccessRate: 1;
}
export const ConfigSchema = z
  .object({
    worldModel: z.enum(['legacy', 'ecology']).default('legacy'),
    controller: z.enum(['atomic', 'hybrid']).default('hybrid'),
    ecoPreset: z.enum(['forager', 'settlement', 'village']).default('forager'),
    startDay: z.number().int().min(1).max(365).default(160),
    regions: z.number().int().min(1).max(3).default(3),
    llmDailyCalls: z.number().int().min(0).max(3).default(2),
    llmDailyTokens: z.number().int().min(0).max(30000).default(6000),
    contextWindow: z.number().int().min(4000).max(262144).optional(),
    size: z.number().int().min(10).max(64),
    population: z.number().int().min(1).max(60),
    days: z.number().int().min(1).max(1000),
    seed: z.number().int().min(0).max(4294967295),
    spawn: z.enum(['clusters', 'uniform', 'compact']),
    wildlifeEnabled: z.boolean().default(true),
    beastRespawnDays: z.number().int().min(0).max(365).default(10),
    beastPowerMultiplier: z.number().min(0.1).max(5).default(1),
    gestation: z.number().int().min(1).max(300),
    adultAge: z.number().int().min(1).max(40000),
    populationLimit: z.number().int().min(1).max(200),
    maxCalls: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxMinutes: z.number().positive(),
    maxCost: z.number().min(0),
    inputPrice: z.number().min(0),
    outputPrice: z.number().min(0),
    cachePrice: z.number().min(0),
    plainFoodCapacity: z.number().int().min(0).max(100).default(4),
    plainRecoveryDays: z.number().int().min(1).max(100).default(5),
    foodShelfLifeDays: z.number().int().min(1).max(100).default(4),
    inventoryCapacity: z.number().int().min(1).max(100).default(15),
    spoiledFoodDamage: z.number().int().min(1).max(100).default(20),
    spoiledFoodHungerGain: z.number().int().min(0).max(100).default(20),
    dailyAP: z.number().int().min(1).max(12).default(5),
    freeDrop: z.boolean().default(true),
    reproductionSuccessRate: z.literal(1).default(1),
  })
  .strict();
export const DEFAULT_CONFIG: Config = {
  worldModel: 'legacy',
  controller: 'hybrid',
  ecoPreset: 'forager',
  startDay: 160,
  regions: 3,
  llmDailyCalls: 2,
  llmDailyTokens: 6000,
  contextWindow: 65536,
  size: 15,
  population: 20,
  days: 100,
  seed: 20260909,
  spawn: 'clusters',
  wildlifeEnabled: true,
  beastRespawnDays: 10,
  beastPowerMultiplier: 1,
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
  plainFoodCapacity: 4,
  plainRecoveryDays: 5,
  foodShelfLifeDays: 4,
  inventoryCapacity: 15,
  spoiledFoodDamage: 20,
  spoiledFoodHungerGain: 20,
  dailyAP: 5,
  freeDrop: true,
  reproductionSuccessRate: 1,
};
export interface Metrics {
  day: number;
  alive: number;
  births: number;
  deaths: number;
  food: number;
  freshFood?: number;
  spoiledFood?: number;
  wildFood: number;
  farms: number;
  avgHunger: number;
  avgLoneliness?: number;
  depressed?: number;
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
  freeActions?: number;
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
  contextCompressions?: number;
  compressionInputTokens?: number;
  compressionOutputTokens?: number;
  elapsedMs: number;
  errors: number;
  repairs: number;
  consecutiveErrors: number;
  estimated: boolean;
  cost: number;
  model: string;
}
export interface World {
  ecology?: Ecology;
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
  id?: string;
  purpose?: 'decision' | 'compression' | 'deep_reflection';
  contextTrace?: {
    turnId: string;
    epoch: number;
    estimatedTokens: number;
    reusedMessages: number;
    recalled: number;
    compressed: boolean;
    prefixHash: string;
  };
  promptVersion?: string;
  status: number;
  content?: string;
  error?: string;
  usage?: Record<string, number>;
  elapsedMs: number;
  model?: string;
}
export interface DecisionRecord {
  storageExperiment?: string;
  brainContext?: unknown;
  source?: 'rule' | 'plan' | 'llm' | 'fallback';
  contextSource?: 'captured' | 'reconstructed-from-events';
  contextPruned?: boolean;
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
  contextNodes?: unknown[];
  elapsedMs?: number;
  format: 'agent-world-v1';
  world: World;
  events: WorldEvent[];
  decisions: DecisionRecord[];
  snapshots: Snapshot[];
}

export interface CorpseView {
  id: number;
  name: string;
  x: number;
  y: number;
  status: 'dead';
}
export interface SurveyResult {
  day: number;
  eventSeq: number;
  origin: [number, number];
  radius: number;
  tiles: {
    x: number;
    y: number;
    terrain: Tile['terrain'];
    resources: Inventory;
    ground?: Inventory;
    freshFood?: number;
    spoiledFood?: number;
    farm?: number;
    farmFood?: number;
    shelter?: 'building' | 'complete';
  }[];
  people: {
    id: number;
    name: string;
    x: number;
    y: number;
    status: 'alive';
    // Older saved surveys did not record sex or age stage.
    sex?: Agent['sex'];
    ageStage?: 'adult' | 'child';
    role?: 'prophet';
    health: string;
  }[];
  corpses: CorpseView[];
}
