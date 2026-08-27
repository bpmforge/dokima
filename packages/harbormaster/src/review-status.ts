/**
 * review-status.ts — what happened when the machine looked at this ticket
 * (W21-34).
 *
 * A ticket reaches `in_review` and waits for a person. That wait is correct:
 * under C-4 a machine verdict is advice and a person accepts, and the review
 * pass deliberately never calls `acceptTicket`. What was missing is that the
 * person doing the accepting was told nothing about whether the machine check
 * happened at all.
 *
 * On the live run that produced this, PLAN-vault-001 landed and its review was
 * skipped — the project had one model configured, so the only candidate
 * reviewer was the maker's own model and C-4 refused it honestly. The founder
 * queue then offered "PLAN-vault-001 is finished — accept it?", which is
 * exactly what it offers for a ticket a second model reviewed and passed. Two
 * materially different situations, one sentence.
 *
 * That matters more than it looks. C-4 exists so work is checked by someone
 * other than its maker; the surface where a person supplies that check is the
 * last place the product should be quiet about whether the machine supplied
 * one first. Accepting reviewed work and accepting unreviewed work are
 * different decisions and should not read the same.
 *
 * Folded from the ledger, latest-wins, exactly like every other projection
 * here — never from a reviewer's own account of what it did (C-2).
 */
import { listEvents, type EventLog } from '@dokima/events';

export type ReviewState =
  | 'passed'
  | 'contradicted'
  | 'inconclusive'
  | 'bounced'
  | 'skipped'
  | 'never-reviewed';

export interface TicketReviewStatus {
  readonly state: ReviewState;
  /** The mechanical reason, when there is one — 'same model as maker', 'no reviewer model'. */
  readonly reason: string | null;
  /** The model that reviewed it, when one did. */
  readonly reviewerModel: string | null;
}

const NEVER_REVIEWED: TicketReviewStatus = {
  state: 'never-reviewed',
  reason: null,
  reviewerModel: null,
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The latest review outcome for a ticket, or `never-reviewed` when no review
 * event mentions it. A ticket whose review was skipped is NOT the same as one
 * no review pass has ever run over, and the two are kept distinct: the first
 * is a refusal with a reason, the second is an absence.
 */
export function reviewStatusFor(log: EventLog, ticketId: string): TicketReviewStatus {
  let latest: TicketReviewStatus = NEVER_REVIEWED;
  for (const event of listEvents(log)) {
    if (event.ticketId !== ticketId) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const reason = asString(payload.reason);
    const reviewerModel = asString(payload.reviewerModel);
    if (event.eventType === 'review.skipped') {
      latest = { state: 'skipped', reason, reviewerModel };
    } else if (event.eventType === 'review.bounced') {
      latest = { state: 'bounced', reason, reviewerModel };
    } else if (event.eventType === 'review.verdict') {
      // The reviewer's three kinds, kept distinct rather than collapsed to
      // pass/fail: "I checked and it does not hold" and "I could not tell" ask
      // different things of the person about to accept.
      const verdict = asString(payload.verdict);
      const state: ReviewState =
        verdict === 'CONFIRMED'
          ? 'passed'
          : verdict === 'CONTRADICTED'
            ? 'contradicted'
            : 'inconclusive';
      latest = { state, reason: verdict, reviewerModel };
    }
  }
  return latest;
}

/**
 * The half-sentence an acceptance prompt appends, so the person accepting
 * knows what they are supplying. Never silent: `never-reviewed` says so
 * plainly rather than omitting the clause, because an omission reads as "fine".
 */
export function reviewStatusSentence(status: TicketReviewStatus): string {
  switch (status.state) {
    case 'passed':
      return `reviewed and confirmed by ${status.reviewerModel ?? 'a second model'}`;
    case 'contradicted':
      return `a second model CONTRADICTED it${status.reviewerModel ? ` (${status.reviewerModel})` : ''} — read the verdict before accepting`;
    case 'inconclusive':
      return `a second model could not verify it either way${status.reviewerModel ? ` (${status.reviewerModel})` : ''} — read the verdict before accepting`;
    case 'bounced':
      return `machine review could not produce a usable verdict${status.reason ? ` (${status.reason})` : ''} — nothing has checked this but you`;
    case 'skipped':
      return `machine review was SKIPPED${status.reason ? ` (${status.reason})` : ''} — nothing has checked this but you`;
    case 'never-reviewed':
      return 'no review pass has run over it — nothing has checked this but you';
  }
}
