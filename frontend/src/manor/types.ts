import { z } from 'zod';
import type { Batch } from '../ecology/types';
export const EstateOp = z.enum([
  'work',
  'withdraw',
  'deposit',
  'give',
  'tribute',
  'craft',
  'break_lock',
  'unlock',
  'lock',
  'rest',
  'guard',
  'report_rebellion',
  'write_ledger',
  'show_ledger',
]);
export const ManorActionSchema = z
  .object({
    type: z.literal('manor'),
    op: EstateOp,
    id: z.string().max(80).optional(),
    item: z.string().max(60).optional(),
    amount: z.number().finite().positive().max(1000).optional(),
    targetId: z.number().int().positive().optional(),
    recipe: z.string().max(60).optional(),
    text: z.string().min(1).max(240).optional(),
  })
  .strict();
export type ManorAction = z.infer<typeof ManorActionSchema>;
export interface Residence {
  reserveDays?: number;
  home: [number, number];
  store: string;
  plots: string[];
  keys: string[];
  biography: string;
}
export interface ManorTile {
  kind:
    | 'green'
    | 'road'
    | 'plaza'
    | 'house'
    | 'field'
    | 'keep'
    | 'gate'
    | 'wall'
    | 'store'
    | 'smithy'
    | 'well';
  label?: string;
  lock?: { key: string; locked: boolean; hp: number };
  plot?: {
    id: string;
    work: number;
    required: number;
    yieldKg: number;
    harvest: number;
    month: number;
  };
}
export interface ManorSettings {
  taxRate: number;
  royalTax: number;
  shockDay: number;
  yieldMultiplier: number;
  // Persisted legacy field name: now the overdue time limit, never a grace period.
  graceDays: number;
  armySize: number;
}
export interface ManorState {
  version: 1;
  plaza: [number, number];
  exit: [number, number];
  manor: [number, number];
  settings: ManorSettings;
  shock: boolean;
  king: {
    dueDay: number;
    received: number;
    totalReceived: number;
    arrears: number;
    phase: 'collecting' | 'warning' | 'expedition';
    deadline?: number; // Legacy snapshots only.
    overdueSince?: number;
    rebellion?: { day: number; reason: string; source: string };
  };
  missions: {
    agentId: number;
    kind: 'messenger' | 'army';
    returning: boolean;
    report?: string;
    witnessed?: number;
    assessment?: string;
    finished?: boolean;
  }[];
  // External royal warrant identifies a person to visit; local actions never check this identity.
  warrantSubject: number;
  treasury: Batch[];
  accounts: { day: number; from: number; to: string; item: string; kg: number }[];
  history: { day: number; text: string }[];
  harvests: { day: number; kg: number; potential: number }[];
}
export interface ManorView {
  residence: Residence;
  map: {
    x: number;
    y: number;
    kind: ManorTile['kind'];
    label?: string;
    id?: string;
    stores: string[];
    blocked: boolean;
  }[];
  nearby: { x: number; y: number; site: ManorTile; stores: { id: string; contents?: Batch[] }[] }[];
  // Physical capacity for local rule planning; not included in the LLM context.
  transferSpace?: { id: number; freeKg: number }[];
  external?: {
    kind: 'messenger' | 'army';
    returning: boolean;
    comrades: number[];
    witnessed?: number;
    assessment?: string;
    targets?: { id: number; x: number; y: number }[];
  };
  shock: boolean;
}
