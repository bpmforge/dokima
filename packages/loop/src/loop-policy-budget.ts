/**
 * Per-finding stall/escalation/oscillation budgets (CODE_BOOK_PROTOCOL chapter of
 * loop-policy.ts — design doc §3-4, FR-L7).
 *
 * Same finding, same tier: 2 targeted attempts then escalate (never a 3rd same-tier try —
 * design doc §3/§4 row 1). After escalation the budget is +1 attempt at the higher tier, then
 * BLOCK on any further STILL_PRESENT (row 2) — no second 2-strike allowance post-escalation.
 * Any REGRESSED (a RESOLVED finding reappearing) escalates immediately; a second REGRESSED for
 * the same finding blocks (row 5, zero tolerance for oscillation — design doc §3).
 */

export type StallDecisionAction = 'RETRY_SAME_TIER' | 'ESCALATE' | 'BLOCK' | 'CLEARED';
export type StallDecisionReason =
  'stall' | 'regression' | 'post_escalation_stall' | 'second_oscillation';

export interface StallDecision {
  readonly action: StallDecisionAction;
  readonly reason?: StallDecisionReason;
  /** Same-tier attempts recorded against this finding since its last escalation (or ever, pre-escalation). */
  readonly attemptsAtTier: number;
}

interface FindingBudgetEntry {
  tierAttempts: number;
  escalated: boolean;
  oscillations: number;
}

export interface FindingBudgetTracker {
  /** Folds one recheck outcome into the finding's budget and returns the resulting action. */
  evaluate(
    fingerprint: string,
    outcome: 'RESOLVED' | 'STILL_PRESENT' | 'REGRESSED',
  ): StallDecision;
  /** Read-only peek, e.g. for tests/inspection — does not mutate. */
  peek(fingerprint: string): Readonly<FindingBudgetEntry> | undefined;
}

export function createFindingBudgetTracker(): FindingBudgetTracker {
  const entries = new Map<string, FindingBudgetEntry>();

  function entryFor(fingerprint: string): FindingBudgetEntry {
    let entry = entries.get(fingerprint);
    if (!entry) {
      entry = { tierAttempts: 0, escalated: false, oscillations: 0 };
      entries.set(fingerprint, entry);
    }
    return entry;
  }

  return {
    evaluate(fingerprint, outcome) {
      const entry = entryFor(fingerprint);

      if (outcome === 'RESOLVED') {
        entries.delete(fingerprint);
        return { action: 'CLEARED', attemptsAtTier: 0 };
      }

      if (outcome === 'REGRESSED') {
        entry.oscillations += 1;
        if (entry.oscillations >= 2) {
          return {
            action: 'BLOCK',
            reason: 'second_oscillation',
            attemptsAtTier: entry.tierAttempts,
          };
        }
        entry.escalated = true;
        entry.tierAttempts = 0;
        return { action: 'ESCALATE', reason: 'regression', attemptsAtTier: 0 };
      }

      // STILL_PRESENT
      if (entry.escalated) {
        entry.tierAttempts += 1;
        return {
          action: 'BLOCK',
          reason: 'post_escalation_stall',
          attemptsAtTier: entry.tierAttempts,
        };
      }
      entry.tierAttempts += 1;
      if (entry.tierAttempts >= 2) {
        entry.escalated = true;
        entry.tierAttempts = 0;
        return { action: 'ESCALATE', reason: 'stall', attemptsAtTier: 2 };
      }
      return { action: 'RETRY_SAME_TIER', attemptsAtTier: entry.tierAttempts };
    },
    peek(fingerprint) {
      const entry = entries.get(fingerprint);
      return entry ? { ...entry } : undefined;
    },
  };
}
