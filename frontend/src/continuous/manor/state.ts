import type { ContinuousConfig } from '../config';
export type Inscription = {
  id: string;
  holder?: number;
  site?: string;
  pages: { time: number; author: number; text: string }[];
  shared: Record<string, string[]>;
};
export type Mission = {
  agentId: number;
  kind: 'messenger' | 'army';
  witnessed?: number;
  assessment?: string;
  finished?: boolean;
  taxPaidAt?: number;
  exitedAt?: number;
  targetId?: number;
};
export type Letter = {
  id: string;
  from: number;
  to: number;
  text: string;
  sentAt: number;
  dueAt: number;
  status: 'transit' | 'held' | 'forwarding' | 'delivered' | 'rejected' | 'undeliverable';
  holder?: number;
  receivedAt?: number;
  note?: string;
};
export type Manor = {
  taxAgent?: number;
  stewardAgent?: number;
  household?: number[];
  letters?: Letter[];
  settings: Pick<
    ContinuousConfig,
    'taxRate' | 'royalTax' | 'shockDay' | 'yieldMultiplier' | 'graceDays' | 'armySize'
  >;
  warrantSubject: number;
  financeAgent: number;
  king: {
    dueDay: number;
    received: number;
    totalReceived: number;
    arrears: number;
    overdueSince?: number;
    phase: 'collecting' | 'warning' | 'expedition';
    rebellion?: string;
  };
  missions: Mission[];
  inscriptions: Inscription[];
  treasury: number;
};
