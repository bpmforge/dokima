/**
 * Iteration classification + subjective-score asymmetry (CODE_BOOK_PROTOCOL chapter of
 * loop-policy.ts — design doc §2, US-410 AC-2/FR-L6 asymmetry).
 */

export type IterationClass =
  'CLEARED' | 'STALLED' | 'PROGRESSED' | 'MIXED' | 'OSCILLATING';

export interface TargetedFindingOutcome {
  readonly fingerprint: string;
  readonly outcome: 'RESOLVED' | 'STILL_PRESENT';
}

export interface IterationInput {
  /** Verdicts recorded this pass for findings a fix attempt explicitly targeted. */
  readonly targeted: readonly TargetedFindingOutcome[];
  /** Count of brand-new fingerprints opened this pass (`PassReportResult.newFindings.length`). */
  readonly newFindingsOpened: number;
  /** Count of RESOLVED findings that reappeared this pass (`PassReportResult.regressedFindings.length`). */
  readonly regressedCount: number;
}

/** Classifies one pass per the design doc §2 ledger-signature table. */
export function classifyIteration(input: IterationInput): IterationClass {
  if (input.regressedCount > 0) {
    return 'OSCILLATING';
  }
  const resolvedCount = input.targeted.filter((t) => t.outcome === 'RESOLVED').length;
  const stillPresentCount = input.targeted.filter(
    (t) => t.outcome === 'STILL_PRESENT',
  ).length;

  if (stillPresentCount === 0) {
    // Everything targeted resolved (including the trivial case of nothing targeted at all).
    return input.newFindingsOpened > 0 ? 'PROGRESSED' : 'CLEARED';
  }
  if (resolvedCount === 0) {
    return 'STALLED';
  }
  return 'MIXED';
}

// --- Subjective review score asymmetry (US-410 AC-2, FR-L6 asymmetry) --------

export type ReviewSignalAction = 'ACCEPT' | 'BOUNDED_POLISH' | 'ESCALATE_TO_HUMAN';

/**
 * Classifies a subjective 1-10 reviewer score over a *passing* deterministic gate. The return
 * type has no FAIL variant — by construction this function cannot auto-fail a passing gate,
 * mirroring calibration.ts's `gateDecision` proof pattern (BLUEPRINT §2.2 two-track
 * verification: ≥7 accept, 5-6 bounded polish, 1-4 escalate to the human).
 */
export function classifySubjectiveScore(subjectiveScore: number): ReviewSignalAction {
  if (!Number.isInteger(subjectiveScore) || subjectiveScore < 1 || subjectiveScore > 10) {
    throw new RangeError(
      `subjectiveScore must be an integer in [1, 10], got ${subjectiveScore}`,
    );
  }
  if (subjectiveScore >= 7) {
    return 'ACCEPT';
  }
  if (subjectiveScore >= 5) {
    return 'BOUNDED_POLISH';
  }
  return 'ESCALATE_TO_HUMAN';
}

/**
 * The asymmetry itself: a subjective score is only ever advisory over a passing deterministic
 * gate. A failing deterministic gate is governed by the finding ledger's own stall/oscillation
 * budgets (loop-policy-budget.ts), never by this function — calling it against a failed gate
 * would blur "advisory opinion" with "the thing that actually gates."
 */
export function classifyReviewSignal(input: {
  readonly subjectiveScore: number;
  readonly deterministicGatePassed: boolean;
}): ReviewSignalAction {
  if (!input.deterministicGatePassed) {
    throw new Error(
      'classifyReviewSignal refused: deterministic gate has not passed — a subjective score ' +
        'is advisory-only over a passing gate (US-410 AC-2), never a substitute for the ' +
        'finding ledger budgets on a failing one',
    );
  }
  return classifySubjectiveScore(input.subjectiveScore);
}
