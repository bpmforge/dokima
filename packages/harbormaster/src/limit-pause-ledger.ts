/**
 * Per-berth limit-pause ledger (FR-G8): tracks how many consecutive provider-limit pauses a
 * berth has hit without an intervening success, and computes the resume time — a stated
 * provider reset time when the classifier found one, otherwise exponential backoff capped at
 * 60 minutes (the acceptance criterion's own cap). Distinct from `@dokima/gateway`'s
 * `CostLedger` (budget/ledger.ts) by construction: that ledger sums USD against a user-set
 * ceiling; this one times a wait against the provider's own limit window — no cost field
 * exists here, and nothing here ever crosses into an approval-card / Decide-tier path.
 */

import type {
  LimitBerthKey,
  LimitClassification,
  LimitPauseRecord,
} from './limit-pause-types.js';

const BACKOFF_BASE_MS = 5 * 60_000;

/** Exponential-backoff fallback cap (FR-G8 acceptance: "exponential-backoff fallback capped at 60m"). */
export const LIMIT_BACKOFF_CAP_MS = 60 * 60_000;

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), LIMIT_BACKOFF_CAP_MS);
}

function berthKey(key: LimitBerthKey): string {
  return `${key.projectId}::${key.runId}::${key.berthId}::${key.providerId}`;
}

export class LimitPauseLedger {
  private readonly attempts = new Map<string, number>();

  /**
   * Records a new pause for `key` and returns the resulting park record. `nowMs` anchors both
   * `pausedAt` and any backoff-computed `resumeAt` (TESTING.md §2: injected clock, no
   * `Date.now()` inside the ledger itself).
   */
  park(
    key: LimitBerthKey,
    classification: LimitClassification,
    nowMs: number,
  ): LimitPauseRecord {
    const attempt = (this.attempts.get(berthKey(key)) ?? 0) + 1;
    this.attempts.set(berthKey(key), attempt);
    const resumeAt =
      classification.resumeAt ?? new Date(nowMs + backoffMs(attempt)).toISOString();
    return {
      ...key,
      pausedAt: new Date(nowMs).toISOString(),
      resumeAt,
      resumeSource: classification.resumeAt ? 'stated' : 'backoff',
      attempt,
    };
  }

  /** Clears a berth's attempt count on a successful resume — its next pause starts backoff over from attempt 1. */
  clear(key: LimitBerthKey): void {
    this.attempts.delete(berthKey(key));
  }

  /** Consecutive-pause count for `key`, 0 if never paused (or already cleared). */
  attemptCount(key: LimitBerthKey): number {
    return this.attempts.get(berthKey(key)) ?? 0;
  }
}
