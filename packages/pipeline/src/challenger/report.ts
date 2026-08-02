/**
 * CHALLENGE_REPORT assembly + CONTRADICTED -> revision HANDOFF (FR-P4, US-405 AC-1/AC-3).
 *
 * `RevisionHandoff`'s shape mirrors `@dokima/loop`'s `Handoff` (handoff.ts) minus the
 * renderer, same as `packages/pipeline/src/phases/types.ts`'s `RevisionHandoff` — that package
 * is out of reach from this ticket's write_scope (see `rerun.ts` header), so the wiring ticket
 * feeds these plain descriptors into the real `renderHandoff` unchanged.
 */

import type {
  Claim,
  ChallengeAttempt,
  ClaimIncomplete,
  ClaimVerdictResult,
} from './claims.js';
import { evaluateClaimChallenge, DEFAULT_MAX_TOOL_CALLS_PER_CLAIM } from './claims.js';

export interface ChallengeReportInput {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly attempts: readonly ChallengeAttempt[];
  readonly maxToolCallsPerClaim?: number;
}

export interface ChallengeReport {
  readonly reportId: string;
  readonly generatedAt: string;
  /** Every recorded (non-bounced) claim verdict. */
  readonly claims: readonly ClaimVerdictResult[];
  /** Bounced claims — missing R-B2 evidence, never counted toward any verdict. */
  readonly incomplete: readonly ClaimIncomplete[];
  /** Subset of `claims` with verdict CONTRADICTED — each forces a revision HANDOFF. */
  readonly contradicted: readonly ClaimVerdictResult[];
}

/** Builds the CHALLENGE_REPORT artifact. Throws `ChallengerSameModelError` (via `evaluateClaimChallenge`) — a maker==verifier collision anywhere in the batch aborts the whole report rather than silently dropping the claim. */
export function buildChallengeReport(input: ChallengeReportInput): ChallengeReport {
  const maxToolCallsPerClaim =
    input.maxToolCallsPerClaim ?? DEFAULT_MAX_TOOL_CALLS_PER_CLAIM;
  const claims: ClaimVerdictResult[] = [];
  const incomplete: ClaimIncomplete[] = [];

  for (const attempt of input.attempts) {
    const outcome = evaluateClaimChallenge(attempt, maxToolCallsPerClaim);
    if (outcome.status === 'INCOMPLETE') {
      incomplete.push(outcome);
      continue;
    }
    claims.push(outcome.result);
  }

  const contradicted = claims.filter((c) => c.verdict === 'CONTRADICTED');

  return {
    reportId: input.reportId,
    generatedAt: input.generatedAt,
    claims,
    incomplete,
    contradicted,
  };
}

export interface ChallengeRevisionHandoff {
  readonly role: string;
  readonly mission: string;
  readonly ticket: { readonly id: string; readonly title: string };
  readonly context: string;
  readonly writeScope: readonly string[];
  readonly produce: readonly string[];
  readonly verify: string;
}

export class UnknownClaimError extends Error {
  constructor(claimId: string) {
    super(
      `CONTRADICTED verdict references claim "${claimId}", which is not in the supplied claim set`,
    );
    this.name = 'UnknownClaimError';
  }
}

function buildHandoff(
  claim: Claim,
  verdict: ClaimVerdictResult,
): ChallengeRevisionHandoff {
  return {
    role: claim.originatingRole,
    mission: `Revise "${claim.text}" in ${claim.artifactPath} — the Challenger CONTRADICTED it`,
    ticket: {
      id: `challenge-revision-${claim.id}`,
      title: `Address CONTRADICTED claim ${claim.id}`,
    },
    context: `${verdict.reasoning}\n${verdict.rerunLine}`,
    writeScope: [claim.artifactPath],
    produce: [
      `an updated ${claim.artifactPath} resolving the CONTRADICTED claim ${claim.id}`,
    ],
    verify: 'challenger re-challenge',
  };
}

/**
 * Every CONTRADICTED verdict in the report forces a revision HANDOFF to the claim's originating
 * role (FR-P4/US-405 AC-3) — mandatory, not optional: this function has no way to omit one.
 */
export function buildRevisionHandoffs(
  report: ChallengeReport,
  claims: readonly Claim[],
): readonly ChallengeRevisionHandoff[] {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  return report.contradicted.map((verdict) => {
    const claim = claimById.get(verdict.claimId);
    if (!claim) throw new UnknownClaimError(verdict.claimId);
    return buildHandoff(claim, verdict);
  });
}
