/**
 * Maker ≠ verifier, made watchable (W20-07, Law 5 / C-4).
 *
 * The rule is already enforced mechanically — reviewer identities are distinct
 * by construction and the receipts prove it. What was missing is that a
 * founder could not *see* it. This module derives, per ticket, who built it
 * and who graded it, so the Team view can show the pair and say plainly that
 * they are never the same person.
 *
 * It reports what the ledger says and nothing more. In particular it does NOT
 * assert the rule held — if maker and reviewer somehow matched, `sameActor`
 * comes back true and the surface says so. A view that could only ever render
 * "correct" would be decoration, not evidence.
 */
import type { BoardTicket } from '../board/types.js';

export interface ReviewPair {
  readonly ticketId: string;
  readonly makerId: string | null;
  readonly reviewerId: string | null;
  /** True only when a reviewer exists AND matches the maker — a real breach. */
  readonly sameActor: boolean;
  /** Did the maker run their own checks before handing in? Diligence, not a grade. */
  readonly selfChecked: boolean;
}

function tail(actorId: string): string {
  return actorId.slice(actorId.lastIndexOf(':') + 1);
}

const SELF_CHECK_MARKERS = ['verify', 'self-check', 'tests ran', 'checked their own'];

export function reviewPairFor(ticket: BoardTicket): ReviewPair {
  const makerId = ticket.ownerId ? tail(ticket.ownerId) : null;
  const reviewer = ticket.history.find(
    (h) =>
      (h.verb === 'accept' || h.verb === 'comment') &&
      (!makerId || tail(h.actorId) !== makerId),
  );
  const reviewerId = reviewer ? tail(reviewer.actorId) : null;
  const selfChecked = ticket.history.some(
    (h) =>
      makerId !== null &&
      tail(h.actorId) === makerId &&
      typeof h.body === 'string' &&
      SELF_CHECK_MARKERS.some((marker) => h.body!.toLowerCase().includes(marker)),
  );
  return {
    ticketId: ticket.id,
    makerId,
    reviewerId,
    // Reported, never assumed — see the module note.
    sameActor: makerId !== null && reviewerId !== null && makerId === reviewerId,
    selfChecked,
  };
}

/** The sentence a founder reads. `nameOf` supplies the face, or the raw id. */
export function reviewPairLine(
  pair: ReviewPair,
  nameOf: (actorId: string) => string,
): string {
  if (!pair.makerId) return 'Nobody has claimed this yet.';
  if (!pair.reviewerId) {
    return `${nameOf(pair.makerId)} built it. Nobody has reviewed it yet.`;
  }
  if (pair.sameActor) {
    // Stated loudly rather than hidden: this would be a breach of Law 5.
    return `${nameOf(pair.makerId)} appears as both maker and reviewer — that should be impossible.`;
  }
  return `${nameOf(pair.makerId)} built it, ${nameOf(pair.reviewerId)} graded it — never the same person.`;
}
