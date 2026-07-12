/**
 * Escalation ladder types (BLUEPRINT §3.3, FR-G3): the cheapest-first,
 * evidence-triggered ladder R0-R4. Shared by every module in this
 * directory rather than declared per-file, mirroring
 * packages/gateway/src/routing/types.ts's layout.
 */

export type Rung = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

/** Straight-line order the ladder always advances in — never revisited, never skipped (TESTING.md §3: "spend rungs are monotonic per ticket"). */
export const RUNG_ORDER: readonly Rung[] = ['R0', 'R1', 'R2', 'R3', 'R4'];

/**
 * One validator/scanner-shaped failure, structurally compatible with
 * packages/events' `ValidatorResult` and packages/loop's anchors.ts
 * `ValidatorResult` — this package cannot depend on either (no workspace
 * dependency declared from this ticket's write_scope, same constraint
 * W2-05 documented), so the shape is reproduced rather than imported.
 */
export interface FailureReceipt {
  readonly name: string;
  readonly exitCode: number;
  readonly gapCount: number;
  readonly gaps?: readonly string[];
}

/** The outcome of one rung's attempt at the ticket's gate. */
export interface GateOutcome {
  readonly passed: boolean;
  /** Evidence for the outcome. Required non-empty when `passed` is false — see MissingFailureEvidenceError. */
  readonly receipts: readonly FailureReceipt[];
  /**
   * The W0-05 `ReceiptRecord.id` this outcome was minted under, when the
   * caller's AttemptRunner mints a real receipt (packages/events'
   * `mintReceipt`/`verifyReceipt`) — not producible here, since this
   * package cannot depend on packages/events. Carrying the id (rather than
   * a re-copied receipt blob) lets a downstream consumer verify the
   * escalation against the actual anchored receipt instead of trusting
   * this event's copy of it.
   */
  readonly receiptId?: string;
}
