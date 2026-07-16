/**
 * Per-claim challenge evaluation (FR-P4, US-405, BLUEPRINT §2.2/§3.3): every HIGH/CRITICAL
 * finding and every claim marked "needs verification" gets an independent challenge pass
 * producing a CONFIRMED / CONTRADICTED / UNVERIFIABLE verdict. Two rules govern the verdict
 * independent of the challenger's raw judgment:
 *
 *  - **Citation-less discard** (US-405 AC-2): a challenge with no citation is discarded —
 *    forced to UNVERIFIABLE, never CONTRADICTED (an uncited "confirmed" is equally untrustworthy
 *    and gets the same treatment; UNVERIFIABLE is the only honest state without a source).
 *  - **Tool-call cap**: a claim challenge that burns through its tool-call budget without
 *    resolving is forced to UNVERIFIABLE — a runaway search loop must never stand in for
 *    evidence, and must never silently keep spending.
 *
 * A verdict also only *counts* when it carries valid R-B2 re-run evidence (`rerun.ts`); missing
 * evidence bounces the whole claim as INCOMPLETE rather than recording an ungrounded verdict.
 */

import { assertChallengerModelDistinct } from './model-guard.js';
import { formatRerunLine, isValidRerun, type RerunEvidence } from './rerun.js';

export type ClaimVerdict = 'CONFIRMED' | 'CONTRADICTED' | 'UNVERIFIABLE';

export interface Citation {
  readonly source: string;
  readonly locator?: string;
}

export interface Claim {
  readonly id: string;
  readonly text: string;
  /** The specialist role that produced this claim — the revision HANDOFF target on CONTRADICTED. */
  readonly originatingRole: string;
  readonly artifactPath: string;
}

export const DEFAULT_MAX_TOOL_CALLS_PER_CLAIM = 5;

export interface ChallengeAttempt {
  readonly claim: Claim;
  /** The challenger's raw judgment before the citation-less/tool-call-cap downgrade rules apply. */
  readonly rawVerdict: ClaimVerdict;
  readonly citations: readonly Citation[];
  readonly toolCallsUsed: number;
  readonly rerun: RerunEvidence | null;
  readonly challengerModel: string;
  readonly makerModel: string;
  readonly reasoning: string;
}

export interface ClaimVerdictResult {
  readonly claimId: string;
  readonly verdict: ClaimVerdict;
  readonly citations: readonly Citation[];
  readonly toolCallsUsed: number;
  readonly downgraded: boolean;
  readonly downgradeReasons: readonly string[];
  readonly rerun: RerunEvidence;
  readonly rerunLine: string;
  readonly reasoning: string;
}

export interface ClaimIncomplete {
  readonly status: 'INCOMPLETE';
  readonly claimId: string;
  readonly reason: string;
}

export interface ClaimRecorded {
  readonly status: 'RECORDED';
  readonly result: ClaimVerdictResult;
}

export type ClaimVerdictOutcome = ClaimIncomplete | ClaimRecorded;

/**
 * Evaluates one claim's challenge attempt. Throws `ChallengerSameModelError` (never a soft
 * downgrade — see `model-guard.ts`) when the challenger and maker models match. Returns
 * INCOMPLETE (bounced, not counted) when the R-B2 re-run evidence is missing or malformed —
 * this check runs first because an ungrounded verdict is worthless regardless of what it says.
 */
export function evaluateClaimChallenge(
  attempt: ChallengeAttempt,
  maxToolCallsPerClaim: number = DEFAULT_MAX_TOOL_CALLS_PER_CLAIM,
): ClaimVerdictOutcome {
  assertChallengerModelDistinct({
    claimId: attempt.claim.id,
    challengerModel: attempt.challengerModel,
    makerModel: attempt.makerModel,
  });

  if (!isValidRerun(attempt.rerun)) {
    return {
      status: 'INCOMPLETE',
      claimId: attempt.claim.id,
      reason: 'missing or malformed re-ran independently evidence (R-B2/FR-L6)',
    };
  }

  let verdict = attempt.rawVerdict;
  const downgradeReasons: string[] = [];

  const hasCitation = attempt.citations.some(
    (citation) => citation.source.trim().length > 0,
  );
  if (!hasCitation && verdict !== 'UNVERIFIABLE') {
    downgradeReasons.push(
      'citation-less challenge discarded — downgraded to UNVERIFIABLE, never CONTRADICTED (US-405 AC-2)',
    );
    verdict = 'UNVERIFIABLE';
  }

  if (attempt.toolCallsUsed > maxToolCallsPerClaim && verdict !== 'UNVERIFIABLE') {
    downgradeReasons.push(
      `tool-call cap (${maxToolCallsPerClaim}) exceeded for claim "${attempt.claim.id}" — forced UNVERIFIABLE`,
    );
    verdict = 'UNVERIFIABLE';
  } else if (attempt.toolCallsUsed > maxToolCallsPerClaim) {
    downgradeReasons.push(
      `tool-call cap (${maxToolCallsPerClaim}) exceeded for claim "${attempt.claim.id}"`,
    );
  }

  return {
    status: 'RECORDED',
    result: {
      claimId: attempt.claim.id,
      verdict,
      citations: attempt.citations,
      toolCallsUsed: attempt.toolCallsUsed,
      downgraded: downgradeReasons.length > 0,
      downgradeReasons,
      rerun: attempt.rerun,
      rerunLine: formatRerunLine(attempt.rerun),
      reasoning: attempt.reasoning,
    },
  };
}
