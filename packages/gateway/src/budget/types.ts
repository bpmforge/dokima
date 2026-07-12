/**
 * Budget ledger + breaker types (BLUEPRINT §3.3, FR-G4, FR-H5): a
 * project/run/ticket-keyed cost ledger and the 70/85/100% circuit breakers
 * that read it. Every `LedgerEntry` carries a berth id so totals aggregate
 * across every berth in a run by construction (FR-H5) — nothing on the way
 * to a threshold check filters by berth.
 */

export interface LedgerKey {
  readonly projectId: string;
  readonly runId: string;
  readonly ticketId: string;
  readonly berthId: string;
}

export interface LedgerEntry extends LedgerKey {
  readonly costUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly model: string;
  readonly recordedAt: string;
}

/** Run and/or project ceiling in USD; the tighter of the two (by ratio) drives the breaker (FR-G4: "per run and per project"). Neither set = unlimited (breaker never trips). */
export interface BudgetLimits {
  readonly runLimitUsd?: number;
  readonly projectLimitUsd?: number;
}

export type BreakerLevel = 'ok' | 'warn' | 'downshift' | 'hard_stop';

/** Ascending order the breaker only ever moves forward through per (project, run) — ledger spend is monotonic, so a level once crossed is never un-crossed. */
export const BREAKER_LEVEL_ORDER: readonly BreakerLevel[] = [
  'ok',
  'warn',
  'downshift',
  'hard_stop',
];

export const BREAKER_THRESHOLDS: Readonly<Record<Exclude<BreakerLevel, 'ok'>, number>> = {
  warn: 0.7,
  downshift: 0.85,
  hard_stop: 1,
};

/** Which limit is driving the current level: 'run' or 'project' spend/limit ratio, whichever is worse. */
export type BreakerScope = 'run' | 'project';

export interface BreakerReading {
  readonly level: BreakerLevel;
  /** Undefined only when no limit is configured at all (ratio stays 0). */
  readonly scope?: BreakerScope;
  readonly ratio: number;
  readonly runSpentUsd: number;
  readonly projectSpentUsd: number;
}

/** Rule-first risk classes an approval card can carry (US-243); this module only ever raises 'budget'. */
export type ApprovalCardRiskClass = 'budget';

/** Decide-tier card raised at 100% (UC-05 step 3) — the human either raises the budget or ends the run (UC-05 step 4). */
export interface ApprovalCard {
  readonly riskClass: ApprovalCardRiskClass;
  readonly projectId: string;
  readonly runId: string;
  readonly scope: BreakerScope;
  readonly summary: string;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly raisedAt: string;
}

/**
 * What a caller should do at the current breaker level. This module only
 * decides — enforcement (skipping a pass, picking a cheaper rung, refusing
 * a ticket claim) belongs to the consumer (packages/loop, and W3-01's
 * harbormaster ticket loop, which depends on this ticket), the same
 * injection-point split escalation/ladder.ts uses for AttemptRunner.
 */
export interface BudgetPolicy {
  readonly skipOptionalPasses: boolean;
  readonly preferCheaperRungs: boolean;
  /** False once the current (project, run) pair has hit hard_stop — the in-flight ticket still completes or checkpoints (UC-05 step 3: "never mid-ticket corruption"); only new claims stop. */
  readonly canClaimNewTicket: boolean;
}
