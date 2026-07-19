/**
 * Challenger citability gate — US-105 AC-2 verbatim: "a slate citing an unchallenged HIGH
 * claim is refused." Only HIGH-impact claims are gated (CHALLENGER_PROTOCOL.md: medium/low
 * findings are explicitly not a trigger point) unless the report's depth policy mandates a
 * verdict on every claim (`deep`, see `depth.ts`). Consumes the real `ClaimVerdict` produced by
 * `../challenger/`'s `evaluateClaimChallenge` — this module never re-derives a verdict, only
 * decides what a verdict (or its absence) means for citability.
 */

import type { ClaimVerdict } from '../challenger/index.js';
import type { DepthPolicy } from './depth.js';
import type { CheckResult, ClaimVerdicts, ResearchClaim } from './types.js';

/** RED FIXTURE case: a HIGH claim with no verdict at all must be refused, same as CONTRADICTED/UNVERIFIABLE. */
export function decideClaimCitability(
  claim: ResearchClaim,
  verdict: ClaimVerdict | null,
): CheckResult {
  if (claim.impact !== 'HIGH') {
    return { valid: true, reasons: [] };
  }
  if (verdict === 'CONFIRMED') {
    return { valid: true, reasons: [] };
  }
  const state =
    verdict === null ? 'no Challenger verdict' : `a ${verdict} Challenger verdict`;
  return {
    valid: false,
    reasons: [
      `HIGH-impact claim "${claim.id}" carries ${state}, not CONFIRMED — a decision may not cite it (FR-P8/US-105 AC-2)`,
    ],
  };
}

export function decideReportCitability(
  claims: readonly ResearchClaim[],
  verdicts: ClaimVerdicts,
): CheckResult {
  const reasons: string[] = [];
  for (const claim of claims) {
    reasons.push(...decideClaimCitability(claim, verdicts.get(claim.id) ?? null).reasons);
  }
  return { valid: reasons.length === 0, reasons };
}

/** True when this claim must carry a Challenger verdict before the report can pass validation —
 * always for HIGH impact, and for every claim when the depth policy mandates it (`deep`). */
export function isChallengerRequired(
  depthPolicy: DepthPolicy,
  claim: ResearchClaim,
): boolean {
  return depthPolicy.challengerMandatory || claim.impact === 'HIGH';
}
