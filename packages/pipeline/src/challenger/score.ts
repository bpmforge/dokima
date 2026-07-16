/**
 * Asymmetric subjective-score threshold for Challenger/reviewer verdicts (R-B2, FR-L6, US-410,
 * BLUEPRINT §2.2): score >=7 accept, 5-6 bounded polish, 1-4 escalate-to-human — a low subjective
 * score never auto-fails a passing deterministic gate. Every such verdict must also carry valid
 * R-B2 re-run evidence to count (US-410 AC-1).
 *
 * `packages/loop/src/loop-policy-classify.ts` already implements the identical threshold for the
 * finding ledger's iteration classifier; that package is out of reach from this ticket's
 * write_scope for the same reason documented in `rerun.ts`. This module mirrors the threshold
 * function so the Challenger service applies the same rule the loop package applies elsewhere —
 * one asymmetry, ported field-for-field, not reinvented.
 */

import { formatRerunLine, isValidRerun, type RerunEvidence } from './rerun.js';

export type ReviewSignalAction = 'ACCEPT' | 'BOUNDED_POLISH' | 'ESCALATE_TO_HUMAN';

/**
 * Classifies a subjective 1-10 score over a *passing* deterministic gate. The return type has no
 * FAIL variant — by construction this function cannot auto-fail a passing gate.
 */
export function classifySubjectiveScore(subjectiveScore: number): ReviewSignalAction {
  if (!Number.isInteger(subjectiveScore) || subjectiveScore < 1 || subjectiveScore > 10) {
    throw new RangeError(
      `subjectiveScore must be an integer in [1, 10], got ${subjectiveScore}`,
    );
  }
  if (subjectiveScore >= 7) return 'ACCEPT';
  if (subjectiveScore >= 5) return 'BOUNDED_POLISH';
  return 'ESCALATE_TO_HUMAN';
}

/**
 * A subjective score is only ever advisory over a passing deterministic gate. A failing
 * deterministic gate is governed by the finding ledger's own stall/oscillation budgets, never by
 * this function — calling it against a failed gate would blur "advisory opinion" with "the thing
 * that actually gates."
 */
export function classifyReviewSignal(input: {
  readonly subjectiveScore: number;
  readonly deterministicGatePassed: boolean;
}): ReviewSignalAction {
  if (!input.deterministicGatePassed) {
    throw new Error(
      'classifyReviewSignal refused: deterministic gate has not passed — a subjective score ' +
        'is advisory-only over a passing gate (US-410 AC-2), never a substitute for the finding ' +
        'ledger budgets on a failing one',
    );
  }
  return classifySubjectiveScore(input.subjectiveScore);
}

export interface ScoreVerdictInput {
  readonly subjectiveScore: number;
  readonly deterministicGatePassed: boolean;
  readonly rerun: RerunEvidence | null;
}

export interface ScoreVerdictIncomplete {
  readonly status: 'INCOMPLETE';
  readonly reason: string;
}

export interface ScoreVerdictRecorded {
  readonly status: 'RECORDED';
  readonly action: ReviewSignalAction;
  readonly rerunLine: string;
}

export type ScoreVerdictOutcome = ScoreVerdictIncomplete | ScoreVerdictRecorded;

/**
 * The full US-410 rule for one reviewer/challenger score verdict: missing R-B2 evidence bounces
 * it as INCOMPLETE (AC-1) before the asymmetric threshold ever runs; a valid verdict is
 * classified per the threshold and carries its evidence line (AC-2).
 */
export function evaluateScoreVerdict(input: ScoreVerdictInput): ScoreVerdictOutcome {
  if (!isValidRerun(input.rerun)) {
    return {
      status: 'INCOMPLETE',
      reason: 'missing or malformed re-ran independently evidence (R-B2/FR-L6)',
    };
  }
  const action = classifyReviewSignal(input);
  return {
    status: 'RECORDED',
    action,
    rerunLine: formatRerunLine(input.rerun),
  };
}
