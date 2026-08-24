/** Agent roster types (SRS FR-E2, R-K1). Mirrors apps/server/src/api/roster.ts's wire shapes. */

export type RosterScope = 'run' | 'project' | 'global' | null;

export interface EffectiveModel {
  chain: string[];
  scope: RosterScope;
  usedDefaultRole: boolean;
}

export interface FitnessCard {
  model: string;
  verdict: 'fit' | 'unfit' | 'marginal';
  harnessVersion: string;
  runAt: string;
}

/** W20-01 (D-028): the face, when this role has one. Absent = render `id`. */
export interface RosterPersona {
  displayName: string;
  avatarKey: string;
  jobLine: string;
}

export interface RosterExpert {
  id: string;
  displayName: string;
  persona?: RosterPersona;
  cluster: string;
  mode: string;
  description: string;
  effectiveModel: EffectiveModel;
  fitnessCards: FitnessCard[];
  /** FR-L8 instruction-cost metadata — null until that producer lands. */
  instructionCost: number | null;
}

export type RosterHistoryKind =
  'handoff' | 'outcome' | 'verdict' | 'spend' | 'escalation' | 'other';

export interface RosterHistoryEntry {
  seq: number;
  eventType: string;
  kind: RosterHistoryKind;
  ticketId: string | null;
  occurredAt: string;
}

export interface AgentHistory {
  agentId: string;
  handoffsRun: number;
  outcomes: number;
  verdictScores: number;
  spend: number;
  escalations: number;
  entries: RosterHistoryEntry[];
}
