/**
 * The review decision, and who signs it (W23-10, AB-10).
 *
 * WHAT A REVIEW RETURNED BEFORE: a verdict word, a score, and an action. That
 * is enough for a person reading a Decide card and nowhere near enough for a
 * runtime deciding whether a ticket may be accepted without one. The caller
 * had to re-derive freshness from events, re-read the check results, and take
 * the model's word for the rest.
 *
 * SO A DECISION CARRIES ITS OWN PROVENANCE: the head it was about, the digest
 * of the source, every independent check's status, and the identities and
 * models on both sides. `eligible` is computed from those facts, and it is
 * false unless every one of them holds — a missing reviewer, a same-model
 * reviewer, a stale snapshot, a truncated diff, a failed or unavailable
 * required check, or a verdict that is not a confirmation.
 *
 * AN INDEPENDENT CHECK DOMINATES THE MODEL. That ordering is not a preference:
 * a scanner's exit code is a fact about the code, and a verdict is an opinion
 * about the code. When they disagree the fact wins, and when the scanner could
 * not run the honest answer is "inconclusive" rather than either of them.
 *
 * AND THE MACHINE SIGNS ITS OWN WORK. Before this, review events were appended
 * under `options.actorId` — the human who started the build. That reads, in an
 * append-only log, as the person having reviewed it. A machine review is the
 * machine's claim and must be attributable to the machine, distinct from the
 * human identity that later accepts (C-4, SC-05).
 */

import { createIdentity, getIdentity, type EventLog } from '@dokima/events';

/** The dedicated reviewer identity. One per project log, minted on first use. */
export const REVIEWER_ACTOR_ID = 'machine-reviewer';

/**
 * Mints the reviewer identity if it does not exist yet, and returns its id.
 *
 * A DISTINCT IDENTITY IS THE MECHANISM, not a label: `acceptTicket` compares
 * identities, and a review signed by the human who started the run would make
 * a later machine acceptance indistinguishable from that person's own.
 */
export function ensureReviewerIdentity(log: EventLog): string {
  if (!getIdentity(log, REVIEWER_ACTOR_ID)) {
    createIdentity(log, {
      id: REVIEWER_ACTOR_ID,
      name: 'Machine reviewer',
      kind: 'machine',
      role: 'code-reviewer',
    });
  }
  return REVIEWER_ACTOR_ID;
}

export type ReviewDecisionVerdict = 'CONFIRMED' | 'CONTRADICTED' | 'UNVERIFIABLE';

export interface ReviewCheckStatus {
  readonly checkId: string;
  readonly status: string;
  readonly required: boolean;
}

export interface ReviewDecision {
  readonly ticketId: string;
  /** The verdict as RECORDED, after ground truth and freshness have had their say. */
  readonly verdict: ReviewDecisionVerdict;
  /** What the model actually said, kept beside it — the two differing is the interesting case. */
  readonly modelVerdict: ReviewDecisionVerdict | null;
  readonly score: number | null;
  readonly reviewedHead: string | null;
  readonly sourceDigest: string | null;
  readonly evidenceComplete: boolean;
  readonly evidenceStillCurrent: boolean;
  readonly gatePassed: boolean;
  readonly checks: readonly ReviewCheckStatus[];
  readonly makerModel: string;
  readonly reviewerModel: string | null;
  readonly reviewerActorId: string;
  /** True only when every precondition for an automated acceptance holds. */
  readonly eligible: boolean;
  /** Every reason it is not eligible. Empty exactly when it is. */
  readonly ineligibleBecause: readonly string[];
}

export interface DecisionFacts {
  readonly ticketId: string;
  readonly modelVerdict: ReviewDecisionVerdict | null;
  readonly score: number | null;
  readonly reviewedHead: string | null;
  readonly sourceDigest: string | null;
  readonly evidenceComplete: boolean;
  readonly evidenceStillCurrent: boolean;
  readonly gatePassed: boolean;
  readonly checks: readonly ReviewCheckStatus[];
  readonly makerModel: string;
  readonly makerModels: readonly string[];
  readonly reviewerModel: string | null;
  readonly reviewerActorId: string;
  /**
   * W23-10 (identity half): the actor that OWNED the ticket while it was
   * being made. The model comparison below is only half of C-4 — two
   * identities can share a model and one identity can review under two — and
   * "maker identity cannot review its own work" is the half a model check
   * cannot see.
   */
  readonly makerActorId: string | null;
}

/**
 * Builds the decision. Every clause is a separate sentence in
 * `ineligibleBecause` on purpose: "not eligible" with one reason is
 * actionable, and "not eligible" with no reason is a shrug.
 */
export function decideReview(facts: DecisionFacts): ReviewDecision {
  const reasons: string[] = [];

  if (facts.makerActorId !== null && facts.reviewerActorId === facts.makerActorId) {
    reasons.push(
      `the reviewer identity (${facts.reviewerActorId}) is the maker's own — an identity never reviews its own work (C-4)`,
    );
  }

  if (facts.reviewerModel === null) {
    reasons.push('no reviewer model is configured — nothing independent looked at this');
  } else if (facts.makerModels.includes(facts.reviewerModel)) {
    // C-4, and it covers every rung: a ticket that landed on R2 must not be
    // reviewed by R2's model either.
    reasons.push(
      `the reviewer (${facts.reviewerModel}) is a model that made work this run — a maker never reviews its own work (C-4)`,
    );
  }

  if (!facts.gatePassed) {
    reasons.push("the core's independent re-run of the verify command failed");
  }

  for (const check of facts.checks) {
    if (!check.required) continue;
    if (check.status === 'error' || check.status === 'unavailable') {
      reasons.push(
        `required check ${check.checkId} is ${check.status} — that is not a pass`,
      );
    } else if (check.status === 'findings') {
      reasons.push(`required check ${check.checkId} reported findings`);
    }
  }

  if (!facts.evidenceComplete) {
    reasons.push('the reviewer was not shown the complete source change');
  } else if (!facts.evidenceStillCurrent) {
    reasons.push(
      'the source changed after the review, so the verdict is about code that moved',
    );
  }

  if (facts.modelVerdict === null) {
    reasons.push('no usable verdict was parsed from the reviewer');
  } else if (facts.modelVerdict !== 'CONFIRMED') {
    reasons.push(`the reviewer's verdict was ${facts.modelVerdict}`);
  }

  /**
   * The recorded verdict. Ground truth first — a failed re-run is CONTRADICTED
   * whatever the model said — then freshness, which can only downgrade a
   * CONFIRMED to UNVERIFIABLE. Nothing here can turn a CONTRADICTED into
   * anything better.
   */
  const verdict: ReviewDecisionVerdict = !facts.gatePassed
    ? 'CONTRADICTED'
    : facts.modelVerdict === 'CONFIRMED' &&
        (!facts.evidenceComplete || !facts.evidenceStillCurrent)
      ? 'UNVERIFIABLE'
      : (facts.modelVerdict ?? 'UNVERIFIABLE');

  return {
    ticketId: facts.ticketId,
    verdict,
    modelVerdict: facts.modelVerdict,
    score: facts.score,
    reviewedHead: facts.reviewedHead,
    sourceDigest: facts.sourceDigest,
    evidenceComplete: facts.evidenceComplete,
    evidenceStillCurrent: facts.evidenceStillCurrent,
    gatePassed: facts.gatePassed,
    checks: facts.checks,
    makerModel: facts.makerModel,
    reviewerModel: facts.reviewerModel,
    reviewerActorId: facts.reviewerActorId,
    eligible: reasons.length === 0,
    ineligibleBecause: reasons,
  };
}
