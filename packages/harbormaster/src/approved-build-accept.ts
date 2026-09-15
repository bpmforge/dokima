/**
 * The acceptance chapter of the `approved-build-v1` book
 * (`approved-build-policy.ts`, W23-01) — split out under the 400-line
 * CODE_BOOK_PROTOCOL cap. Extraction only: no rule changed in the move.
 *
 * It holds the two decision constructors every rule in the book uses, and the
 * one branch that can END a ticket without a person: machine acceptance. That
 * pairing is deliberate. `ask` is the constructor the whole policy reaches for
 * dozens of times and `go` the one it reaches for rarely, and they live beside
 * the rules where getting it wrong actually costs something.
 *
 * The type-only import from the book barrel is erased at compile time, so
 * there is no runtime cycle: `approved-build-policy.js` imports values from
 * this file, and this file imports nothing from it.
 */

import type {
  ApprovedBuildAction,
  ApprovedBuildDecision,
} from './approved-build-policy.js';

export const ask = (ruleId: string, reason: string): ApprovedBuildDecision => ({
  action: 'ask_human',
  ruleId,
  reason,
});

export const go = (
  ruleId: string,
  reason: string,
  action: ApprovedBuildAction = 'proceed',
): ApprovedBuildDecision => ({ action, ruleId, reason });

/** Review facts, all minted by the runtime: identities and digests it holds, not claims it was told. */
export interface ApprovedBuildReviewFacts {
  readonly makerIdentityId: string | null;
  readonly reviewerIdentityId: string | null;
  readonly makerModelId: string | null;
  readonly reviewerModelId: string | null;
  readonly verdict: 'confirmed' | 'rejected' | 'inconclusive' | null;
  /** Digest of the source the reviewer actually saw. */
  readonly reviewedSourceDigest: string | null;
  /** Digest of the source as it stands now. Different means the review is stale, whatever it said. */
  readonly currentSourceDigest: string | null;
  /** Every REQUIRED check passed — an error/unavailable required check is not a pass (§6). */
  readonly requiredChecksAllPassed: boolean;
  /** The close gate's receipt refers to the current head. */
  readonly receiptFresh: boolean;
}

/**
 * Machine acceptance (D-020) is the single most dangerous branch in this file,
 * so every one of its preconditions is an independent refusal with its own
 * rule id: a missing reviewer, a maker reviewing itself (C-4), a verdict that
 * is not a confirmation, a review of source that has since changed, a required
 * check that did not pass, and a receipt that no longer refers to the current
 * head. Model-originated confidence is not on this list at all — a CONFIRMED
 * verdict is necessary and nowhere near sufficient.
 */
export function decideMachineAccept(
  review: ApprovedBuildReviewFacts | undefined,
): ApprovedBuildDecision {
  if (!review) return ask('accept-no-review', 'no review evidence at all');
  if (!review.reviewerIdentityId) {
    return ask(
      'accept-no-reviewer',
      'no independent reviewer identity — an unavailable reviewer is not an approval',
    );
  }
  if (review.reviewerIdentityId === review.makerIdentityId) {
    return ask(
      'accept-maker-is-verifier',
      'maker and reviewer are the same identity (C-4)',
    );
  }
  if (review.reviewerModelId !== null && review.reviewerModelId === review.makerModelId) {
    return ask(
      'accept-same-model',
      'maker and reviewer are the same model — a second model or a human is required (C-4)',
    );
  }
  if (review.verdict !== 'confirmed') {
    return ask(
      'accept-verdict-not-confirmed',
      `review verdict is "${review.verdict ?? 'none'}"`,
    );
  }
  if (!review.requiredChecksAllPassed) {
    return ask(
      'accept-required-check-failed',
      'a required check did not pass — error and unavailable are not passes',
    );
  }
  if (!review.receiptFresh) {
    return ask(
      'accept-stale-receipt',
      'the close-gate receipt does not refer to the current head',
    );
  }
  if (
    review.reviewedSourceDigest === null ||
    review.currentSourceDigest === null ||
    review.reviewedSourceDigest !== review.currentSourceDigest
  ) {
    return ask(
      'accept-stale-review',
      'the source changed after the review — the old verdict cannot be reused',
    );
  }
  return go(
    'machine-accept',
    'a fresh independent review and every required check confirm the current head',
    'machine_accept',
  );
}
