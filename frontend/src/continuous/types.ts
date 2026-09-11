import { z } from 'zod';

export const DAY = 86_400_000;
export const DAY_WALL_MS = 120_000;
export const SPEED = DAY / DAY_WALL_MS;
export const TILE = 15;
export const RATION = 2500 / 3400;
export type Point = { x: number; y: number };
export type Site = Point & {
  id: string;
  label: string;
  kind: 'home' | 'hall' | 'field' | 'plaza' | 'well' | 'workshop' | 'gate';
};
export type Task = {
  kind: 'navigate' | 'supply' | 'farm' | 'deliver' | 'rest' | 'guard';
  target: string;
  amount: number;
};
export const PlanSchema = z
  .object({
    intent: z.string().min(1).max(400),
    task: z
      .object({
        kind: z.enum(['navigate', 'supply', 'farm', 'deliver', 'rest', 'guard']),
        target: z.string().min(1).max(60),
        amount: z.number().finite().positive().max(100).default(5),
      })
      .strict()
      .nullable()
      .optional(),
    routine: z
      .object({
        eat: z.boolean(),
        fetch: z.boolean(),
        reserveDays: z.number().min(1).max(10),
        work: z.boolean(),
      })
      .strict()
      .optional(),
    speech: z
      .object({
        mode: z.enum(['talk', 'public_speak', 'shout']),
        text: z.string().min(1).max(240),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;
export type Motion = {
  points: Point[];
  start: number;
  end: number;
  lengths: number[];
  total: number;
};
export type Action = {
  kind: 'walk' | 'eat' | 'withdraw' | 'deposit' | 'work' | 'rest' | 'wait';
  start: number;
  end: number;
  target: string;
  amount: number;
  auto?: boolean;
};
export type Agent = Point & {
  id: number;
  name: string;
  color: number;
  sex: 'F' | 'M';
  personality: number[];
  biography: string;
  home: string;
  plot: string;
  keys: string[];
  hp: number;
  food: number;
  bodyAt: number;
  grain: number;
  capacity: number;
  dead: boolean;
  planVersion: number;
  intent: string;
  task?: Task;
  routine: { eat: boolean; fetch: boolean; reserveDays: number; work: boolean };
  motion?: Motion;
  action?: Action;
  voice?: { text: string; mode: 'talk' | 'public_speak' | 'shout'; start: number; end: number };
  blocked?: { reason: string; version: number };
  thinking?: { id: string; version: number; at: number };
  nextThink: number;
  lastRead: number;
  thoughts: number;
  tokens: number;
  stats: { workMs: number; distance: number; eatenKg: number; spoken: number; deliveredKg: number };
};
export type Store = Point & { id: string; label: string; grain: number; reserved: number };
export type Field = Point & {
  id: string;
  label: string;
  work: number;
  required: number;
  harvest: number;
};
export type Gate = Point & { id: string; label: string; open: boolean; key: string };
export type World = {
  settings?: import('./config').ContinuousConfig;
  version: 'continuous-prototype-1';
  id: string;
  time: number;
  seq: number;
  status: 'running' | 'paused' | 'complete';
  mode: 'scripted' | 'llm';
  days: number;
  size: { w: number; h: number };
  sites: Site[];
  walls: Point[];
  roads: Point[];
  agents: Agent[];
  stores: Store[];
  fields: Field[];
  gates: Gate[];
  resourceVersion: number;
  nextBody: number;
  nextDay: number;
  ledger: { initial: number; grown: number; eaten: number };
  calls: number;
  maxCalls: number;
};
export type Patch = {
  agents?: Agent[];
  stores?: Store[];
  fields?: Field[];
  gates?: Gate[];
  meta: Partial<
    Omit<World, 'agents' | 'stores' | 'fields' | 'gates' | 'sites' | 'walls' | 'roads' | 'size'>
  >;
};
export type Event = {
  channel?: 'talk' | 'public_speak' | 'shout';
  seq: number;
  time: number;
  type: string;
  actor?: number;
  text: string;
  listeners?: number[];
  patch: Patch;
};

export function position(a: Agent, time: number): Point {
  const m = a.motion;
  if (!m) return { x: a.x, y: a.y };
  const d = Math.max(0, Math.min(1, (time - m.start) / (m.end - m.start))) * m.total;
  let remaining = d;
  for (let i = 0; i < m.lengths.length; i++) {
    const length = m.lengths[i];
    if (remaining <= length || i === m.lengths.length - 1) {
      const f = length ? Math.min(1, remaining / length) : 1;
      return {
        x: m.points[i].x + (m.points[i + 1].x - m.points[i].x) * f,
        y: m.points[i].y + (m.points[i + 1].y - m.points[i].y) * f,
      };
    }
    remaining -= length;
  }
  return m.points.at(-1)!;
}

export function body(a: Agent, time: number) {
  if (a.dead) return { food: a.food, hp: 0 };
  const days = Math.max(0, time - a.bodyAt) / DAY;
  const fedDays = Math.min(days, a.food / 2500);
  return {
    food: Math.max(0, a.food - days * 2500),
    hp: Math.max(0, Math.min(100, a.hp + fedDays * 2) - (days - fedDays) * 15),
  };
}

export function applyEvent(w: World, e: Event): void {
  for (const key of ['agents', 'stores', 'fields', 'gates'] as const) {
    const rows = e.patch[key];
    if (rows)
      for (const row of rows) {
        const index = w[key].findIndex((v) => v.id === row.id);
        if (index >= 0) (w[key] as unknown[])[index] = structuredClone(row);
      }
  }
  Object.assign(w, structuredClone(e.patch.meta));
  w.seq = e.seq;
  w.time = e.time;
}

export function clockLabel(t: number) {
  const minute = Math.floor(t / 60000) % 1440;
  return `第 ${Math.floor(t / DAY) + 1} 天 ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
