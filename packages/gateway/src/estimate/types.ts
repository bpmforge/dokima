/**
 * Dry-run cost estimate types (BLUEPRINT §12.2, FR-G7, US-307/309): the
 * pre-autorun estimate (ticket points × role matrix × historical
 * per-ticket actuals) and the escalation-ROI / suppression-volume rollups
 * that feed the weekly Review-tier digest (GATE_ECONOMICS §3). This
 * package cannot depend on `@shipwright/tickets`/`@shipwright/events`/
 * `packages/loop` (no workspace dependency declared, same constraint
 * documented throughout packages/gateway — see escalation/types.ts's
 * `FailureReceipt` note) — vocabulary (`Rung`, ticket outcome, suppression
 * justification enum) is reproduced from docs/DATABASE.md rather than
 * imported.
 */

import type { Rung } from '../escalation/types.js';

/** One ticket's contribution to the estimate — `points` defaults to 1 at every real call site today: no `points` field exists on `@shipwright/tickets`' `Ticket` yet (grep-verified), the same honest-placeholder gap `apps/server/src/api/server/board-wire.ts` documents for `wave`. */
export interface TicketSizeInput {
  readonly ticketId: string;
  readonly wave: number;
  readonly points: number;
}

/** One role's blended $/point rate under the current matrix (BLUEPRINT §3.3 role list: coding-agent, code-reviewer, challenger, test-engineer, pm-interviewer, default). Every role that touches a ticket contributes its rate; swapping one role's rate is the "what-if" (BLUEPRINT §12.2: "$0.60 if the review role drops to Sonnet"). */
export interface RoleRate {
  readonly role: string;
  readonly usdPerPoint: number;
}

/** A completed ticket's real spend-per-point, when known — overrides the matrix-derived rate for the wave(s) it informs (BLUEPRINT §12.2: "historical per-ticket actuals"). */
export interface HistoricalActual {
  readonly ticketId: string;
  readonly points: number;
  readonly actualUsd: number;
}

export interface WaveEstimate {
  readonly wave: number;
  readonly ticketCount: number;
  readonly totalPoints: number;
  readonly usdPerPoint: number;
  readonly estimatedUsd: number;
  /** 'historical' when >=1 historical actual informed this wave's rate, else 'matrix'. */
  readonly rateSource: 'historical' | 'matrix';
}

export interface EstimateResult {
  readonly waves: readonly WaveEstimate[];
  readonly totalUsd: number;
  /** Human-readable notes on what fed the estimate — never silent about a gap (C-1), e.g. "no historical actuals; matrix list-price only". */
  readonly assumptions: readonly string[];
}

/** One ledger entry carrying the rung it was spent at and the ticket's resulting outcome — `budget/types.ts`'s `LedgerEntry` has no `rung`/`outcome` (W2-07's write_scope predates the escalation ladder's rung concept landing on the ledger); reproduced here rather than widening that module out of this ticket's write_scope. */
export interface RungLedgerEntry {
  readonly ticketId: string;
  readonly rung: Rung;
  readonly costUsd: number;
  /** Mirrors `@shipwright/tickets`' `TicketStatus` vocabulary (reproduced, not imported — see module header). */
  readonly outcome:
    'ready' | 'claimed' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'waived';
}

export interface EscalationRoiTicketRow {
  readonly ticketId: string;
  readonly spendUsd: number;
  readonly outcome: RungLedgerEntry['outcome'];
}

export interface EscalationRoiRungGroup {
  readonly rung: Rung;
  readonly totalUsd: number;
  readonly tickets: readonly EscalationRoiTicketRow[];
}

/** Mirrors docs/DATABASE.md §5b `suppressions.justification` enum (FR-RL3). */
export type SuppressionJustification =
  | 'false_positive'
  | 'not_applicable_scope'
  | 'accepted_risk'
  | 'fixed_elsewhere'
  | 'wont_fix_documented';

export interface SuppressionRecord {
  readonly ruleId: string;
  readonly fingerprint: string;
  readonly justification: SuppressionJustification;
}

/** Per-rule suppression volume — a demotion-review input (GATE_ECONOMICS §3: ">50% trailing FP" flags demotion), sorted highest-volume first. */
export interface SuppressionDigestRow {
  readonly ruleId: string;
  readonly count: number;
}

export interface WeeklyDigestCard {
  readonly tier: 'review';
  readonly weekOf: string;
  readonly totalSpendUsd: number;
  readonly byRung: readonly EscalationRoiRungGroup[];
  readonly suppressionVolume: readonly SuppressionDigestRow[];
  readonly assumptions: readonly string[];
}
