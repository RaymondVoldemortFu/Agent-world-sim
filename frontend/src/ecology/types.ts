import { EstateOp, type ManorView } from '../manor/types';
import { z } from 'zod';
import type { Decision, Memory } from '../sim/types';
export type Biome = 'forest' | 'meadow' | 'wetland' | 'floodplain' | 'hill' | 'water';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export interface Inscription {
  carrierId?: string;
  id: string;
  authorId: number;
  authorName: string;
  day: number;
  eventSeq: number;
  text: string;
}
export interface Batch {
  pages?: Inscription[]; // Personal ledger entries travel with the physical book.
  inscription?: Inscription;
  id: string;
  item: string;
  kg: number;
  water: number;
  quality: number;
  risk: number;
  created: number;
  source: string;
  wear?: number;
}
export interface Deposit {
  item: string;
  kg: number;
  grade: number;
  depth: number;
}
export interface Field {
  id: string;
  area: number;
  crop?: string;
  planted?: number;
  gdd: number;
  work: number;
  harvestWork: number;
  sowingWork?: number;
  seededKg?: number;
  biomass: number;
  waterStress: number;
  fertility: number;
  harvestKg: number;
  stage: 'clearing' | 'prepared' | 'growing' | 'ripe' | 'fallow';
}
export interface Structure {
  id: string;
  kind: string;
  progress: number;
  condition: number;
  contents: Batch[];
}
export interface Herd {
  id: string;
  species: 'goat' | 'sheep' | 'cattle';
  count: number;
  females: number;
  health: number;
  hunger: number;
  milkDay: number;
  offspringProgress: number;
}
export interface EcoTile {
  region: number;
  biome: Biome;
  area: number;
  slope: number;
  soilWater: number;
  waterCapacity: number;
  nitrogen: number;
  organic: number;
  erosion: number;
  surfaceWater: number;
  contamination: number;
  biomass: Record<string, number>;
  capacity: Record<string, number>;
  deposits: Deposit[];
  ground: Batch[];
  fields: Field[];
  structures: Structure[];
  herds: Herd[];
  improvements: Record<string, number>;
  disturbance: number;
}
export interface EcoBody {
  serial?: number;
  survey?: EcoObservation;
  region: number;
  readyAt: number;
  foodKcal: number;
  waterL: number;
  cold: number;
  sickness: number;
  protein: number;
  stock: Batch[];
  skills: Record<string, number>;
  knowledge: string[];
}
export interface Climate {
  year: number;
  day: number;
  season: Season;
  temperature: number;
  rain: number;
  daylight: number;
  drought: number;
}
export interface Job {
  id: string;
  recipe: string;
  region: number;
  x: number;
  y: number;
  started: number;
  readyDay: number;
  work: number;
  inputs: Batch[];
  operators: number[];
  state: 'working' | 'waiting' | 'complete' | 'cancelled';
  quality: number;
  lastTended: number;
}
export interface ScheduledAction {
  id: string;
  actor: number;
  at: number;
  decision: Decision;
}
export interface Beast {
  id: string;
  species: 'bear' | 'boar' | 'wolf_pack';
  region: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  born: number;
  mode: 'raiding' | 'roaming';
  deathDay?: number;
}
export interface Settlement {
  region: number;
  x: number;
  y: number;
  population: number;
  infrastructure: number;
}
export interface Ecology {
  version: 'eco-1';
  village?: {
    region: number;
    x: number;
    y: number;
    farmlandHa: number;
    foodKg: number;
    seedKg: number;
  };
  relicCorpses?: { id: number; name: string; x: number; y: number; region: number }[];
  beasts?: Beast[];
  wildlifeDay?: number;
  clock: number;
  nextId: number;
  climate: Climate;
  jobs: Job[];
  pending: ScheduledAction[];
  regionNames: string[];
  ledger: {
    gatheredKg: number;
    consumedKcal: number;
    spoiledKg: number;
    burnedKg: number;
    outputKg: number;
    wasteKg: number;
    harvestedKg: number;
    births: number;
  };
  brainStats: { ruleActions: number; planActions: number; llmDecisions: number; fallbacks: number };
}
export const EcoActionSchema = z
  .object({
    type: z.literal('eco'),
    op: z.enum([
      'collect',
      'eat',
      'drink',
      'water',
      'transfer',
      'discard',
      'start_job',
      'work_job',
      'cancel_job',
      'construct',
      'repair',
      'clear',
      'sow',
      'tend',
      'harvest',
      'improve',
      'herd',
      'travel',
      'study',
      'fight_beast',
      'inscribe',
    ]),
    item: z.string().max(60).optional(),
    text: z.string().min(1).max(240).optional(),
    amount: z.number().finite().positive().max(1000).optional(),
    targetId: z.number().int().positive().optional(),
    id: z.string().max(100).optional(),
    recipe: z.string().max(60).optional(),
    crop: z.string().max(30).optional(),
    destination: z.enum(['ground', 'bag', 'person', 'storage']).optional(),
    region: z.number().int().min(0).max(2).optional(),
  })
  .strict();
export type EcoAction = z.infer<typeof EcoActionSchema>;
export const GoalSchema = z
  .object({
    op: EstateOp.optional(),
    id: z.string().max(80).optional(),
    skill: z.enum([
      'estate',
      'hunt',
      'survey',
      'learn',
      'repair',
      'confront',
      'defend',
      'inscribe',
      'secure_food',
      'gather',
      'navigate',
      'make',
      'build',
      'farm',
      'deliver',
      'meet',
      'reproduce',
      'explore',
      'improve',
      'herd',
    ]),
    recipe: z.string().max(60).optional(),
    targetId: z.number().int().positive().optional(),
    item: z.string().max(60).optional(),
    text: z.string().min(1).max(240).optional(),
    quantity: z.number().min(0).max(1000).optional(),
    x: z.number().int().min(0).max(63).optional(),
    y: z.number().int().min(0).max(63).optional(),
    region: z.number().int().min(0).max(2).optional(),
    expires: z.number().int().positive(),
  })
  .strict();
export type Goal = z.infer<typeof GoalSchema>;
export const DailyRoutineSchema = z
  .object({
    mode: z.enum(['default', 'custom', 'off']),
    eat: z.boolean().optional(),
    fetchFood: z.boolean().optional(),
    storeSurplus: z.boolean().optional(),
    farm: z.boolean().optional(),
    storeId: z.string().min(1).max(100).optional(),
    plots: z.array(z.string().min(1).max(60)).max(48).optional(),
    reserveDays: z.number().min(0).max(30).optional(),
    idleAt: z
      .tuple([z.number().int().min(0).max(63), z.number().int().min(0).max(63)])
      .nullable()
      .optional(),
  })
  .strict();
export type DailyRoutine = z.infer<typeof DailyRoutineSchema>;
export const BrainOutputSchema = z
  .object({
    intent: z.string().max(200),
    goal: GoalSchema.optional(),
    clearGoal: z.boolean().optional(),
    dailyRoutine: DailyRoutineSchema.optional(),
    combatPolicy: z
      .object({
        mode: z.enum(['flee', 'low_hp', 'fight']),
        retreatHp: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    movement: z
      .object({
        stayMinutes: z.number().int().min(0).max(18000).optional(),
        returnAfterGather: z.boolean().optional(),
      })
      .strict()
      .optional(),
    speech: z
      .object({
        targetId: z.number().int().positive().optional(),
        channel: z.enum(['chat', 'shout', 'public_speak']),
        text: z.string().min(1).max(240),
      })
      .strict()
      .optional(),
    agreement: z
      .discriminatedUnion('operation', [
        z
          .object({ operation: z.literal('propose'), targetId: z.number().int().positive() })
          .strict(),
        z.object({ operation: z.literal('accept'), proposalId: z.string().max(100) }).strict(),
        z.object({ operation: z.literal('revoke'), proposalId: z.string().max(100) }).strict(),
      ])
      .optional(),
    reflection: z
      .object({ summary: z.string().min(1).max(800), plan: z.string().min(1).max(800) })
      .strict()
      .optional(),
    note: z.string().max(300).optional(),
    recall: z.string().min(1).max(120).optional(),
    inspectRecipe: z.string().min(1).max(60).optional(),
  })
  .strict()
  .superRefine((out, ctx) => {
    if (out.goal?.skill === 'navigate' && (out.goal.x === undefined || out.goal.y === undefined))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'navigate 必须提供目的地 x 和 y' });
    if (
      out.speech?.channel === 'public_speak' &&
      (out.speech.targetId !== undefined || out.agreement)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'public_speak 面向附近所有活人，无需 targetId；繁衍 agreement 请单独提交。',
      });
  });
export type BrainOutput = z.infer<typeof BrainOutputSchema>;
export interface Brain {
  executionBlock?: { signature: string; reason: string };
  dailyRoutine?: DailyRoutine;
  estateEmptyStoreDay?: number;
  estateWork?: { month: number; plots: Record<string, { work: number; harvest: number }> };
  goalBlocked?: string;
  lastDeepReflectionDay?: number;
  deepReflection?: { day: number; summary: string; plan: string };
  navigation?: {
    status: 'moving' | 'arrived' | 'blocked';
    steps?: number;
    reason?: string;
    destination?: [number, number];
    day?: number;
  };
  lastTaskResult?: {
    day: number;
    position: [number, number];
    op: string;
    id?: string;
    item?: string;
    amount?: number;
    targetId?: number;
    recipe?: string;
  };
  combatPolicy?: { mode: 'flee' | 'low_hp' | 'fight'; retreatHp?: number };
  movement?: { holdUntil?: number; returnAfterGather?: boolean };
  forageTrip?: { origin: [number, number]; region: number; returning: boolean };
  gatherOrigin?: { position: [number, number]; region: number };
  readInscriptions?: string[];
  contextHead?: string;
  recallQuery?: string;
  recipeQuery?: string;
  version: 'brain-1';
  tokensDay?: number;
  visits?: Record<string, number>;
  procurement?: { item: string; need: number; site: [number, number] };
  goal?: Goal;
  lastThought: number;
  lastTalk: number;
  callsDay: number;
  calls: number;
  handled: string[];
  places: {
    x: number;
    y: number;
    region: number;
    day: number;
    food: number;
    biome: Biome;
    bridge?: boolean;
    resources?: Record<string, number>;
    people?: number[];
  }[];
  failures: number;
  lastFailure?: string;
  source: 'rule' | 'plan' | 'llm' | 'fallback';
  thought?: string;
  consent?: { proposalId: string; expires: number };
  lastReflection: number;
}
export interface BrainUpdate {
  brain: Brain;
  knowledge?: string[];
}
export interface EcoObservation {
  manor?: ManorView;
  seq: number;
  protocol: 'hybrid-1';
  day: number;
  climate: Climate;
  minute: number;
  self: {
    id: number;
    name: string;
    role?: 'prophet';
    sex: 'F' | 'M';
    adult: boolean;
    hp: number;
    hunger: number;
    ap: number;
    position: [number, number];
    body: EcoBody;
    brain: Brain;
    personality: number[];
    combat?: { attack: number; protection: number; weapon: string; armor: string; shield: string };
    loneliness: number;
    lonelinessCapacity: number;
    depressed: boolean;
    pregnancy?: { due: number };
    cooldownUntil: number;
  };
  tiles: { x: number; y: number; eco: EcoTile }[];
  people: {
    id: number;
    name: string;
    sex: 'F' | 'M';
    adult: boolean;
    x: number;
    y: number;
    health: string;
    busyUntil: number;
    role?: string;
  }[];
  relicCorpses?: { id: number; name: string; x: number; y: number; region: number }[];
  beasts?: Beast[];
  inscriptions?: Inscription[];
  settlements?: Settlement[];
  corpses: { id: number; name: string; x: number; y: number }[];
  messages: Memory[];
  memories: Memory[];
  proposals: {
    id: string;
    from: number;
    to: number;
    day: number;
    accepted: boolean;
    attempts: Record<number, number>;
  }[];
  jobs: Job[];
  lastSurvey?: {
    day: number;
    relicCorpses?: { id: number; name: string; x: number; y: number; region: number }[];
    beasts?: Beast[];
    tiles: { x: number; y: number; eco: EcoTile }[];
    people: EcoObservation['people'];
    corpses: EcoObservation['corpses'];
  };
  policy: {
    mapSize: number;
    remainingCalls: number;
    remainingTokens?: number;
    contextWindow?: number;
    wildlifeEnabled?: boolean;
    beastRespawnDays?: number;
    beastPowerMultiplier?: number;
    gestationDays?: number;
    adultAgeDays?: number;
    rulesVersion?: string;
    controller: string;
    llmDailyCalls: number;
    llmDailyTokens: number;
    bagKg: number;
    dailyAP: number;
    budgetAvailable: boolean;
  };
}
