/**
 * Shared types for runs + clarifications (DATABASE.md §3/§4, FR-H3/FR-N1,
 * W3-03). Split per CODE_BOOK_PROTOCOL.md so `breakpoints-runs.ts` and
 * `breakpoints-clarifications.ts` share one vocabulary without importing
 * each other in a cycle; `breakpoints.ts` is the barrel plus the pure
 * breakpoint-mode decision (no DB access).
 */

export type BreakpointMode = 'ticket' | 'wave' | 'never';

export type RunMode = 'new_product' | 'onboard' | 'feature' | 'improve';

export type RunStatus = 'running' | 'paused' | 'suspended' | 'done' | 'stopped';

export interface RunRecord {
  readonly id: string;
  readonly projectId: string;
  readonly mode: RunMode;
  readonly phase: number | null;
  readonly status: RunStatus;
  readonly breakpoint: BreakpointMode;
  readonly berths: number;
  readonly budgetUsd: number | null;
  readonly budgetTokens: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export type ClarificationStatus = 'open' | 'answered' | 'dismissed';

export interface ClarificationRecord {
  readonly id: string;
  readonly runId: string;
  readonly ticketId: string | null;
  readonly askedBy: string;
  readonly question: string;
  readonly context: unknown;
  readonly options: unknown;
  readonly defaultAction: string;
  readonly status: ClarificationStatus;
  readonly answer: string | null;
  /** Opaque caller-supplied resume point (DATABASE.md §4 "resume point"). */
  readonly checkpointRef: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}
