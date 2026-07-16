/**
 * Morning-review queue projection (BLUEPRINT §3.7/§5.2, FR-H4, SRS FR-H4).
 * Pure projection over `ReviewCard`s a caller has already built (e.g. from
 * a parked ticket's manifest + close receipt) — this module does not spawn
 * git or touch a database; it is the deterministic sort + card-shape layer
 * FR-H4's "Queue projection sorted by leverage" acceptance criterion asks
 * for, kept independently testable per CODE_BOOK_PROTOCOL.md.
 */

import type { ReceiptRecord } from '@shipwright/events';
import {
  CARD_KINDS,
  type CardKind,
  type DiffStat,
  type ReviewCard,
  type RiskClass,
} from './review-queue-types.js';

/**
 * Leverage rank per card kind (BLUEPRINT §5.2: "merges first — they unblock
 * lanes — then approvals, then clarifications, then FYI digests"; DATABASE
 * §3 `notifications.leverage`, "merges rank highest"). Gaps between values
 * leave room for a future finer-grained tie-break without renumbering.
 */
export const LEVERAGE_RANK: Readonly<Record<CardKind, number>> = Object.freeze({
  merge: 40,
  approval: 30,
  clarification: 20,
  digest: 10,
});

/** Derives a diff-stat from a ticket's own verified changed-file list — never self-reported (SC-02). */
export function diffStatFromFiles(files: readonly string[]): DiffStat {
  return { filesChanged: files.length, files };
}

export interface BuildReviewCardInput {
  readonly id: string;
  readonly kind: CardKind;
  readonly riskClass: RiskClass | null;
  readonly title: string;
  readonly summary: string;
  readonly files: readonly string[];
  readonly receipts: readonly ReceiptRecord[];
  readonly ticketId?: string | null;
  readonly createdAt: string;
}

/**
 * Builds one queue card. Every card carries a diff-stat and its receipts
 * (FR-H4 acceptance 2) — both are required inputs here, not optional, so a
 * caller cannot construct a card that omits them.
 */
export function buildReviewCard(input: BuildReviewCardInput): ReviewCard {
  if (!CARD_KINDS.includes(input.kind)) {
    throw new Error(`unknown review-card kind '${input.kind}'`);
  }
  return {
    id: input.id,
    kind: input.kind,
    riskClass: input.riskClass,
    title: input.title,
    summary: input.summary,
    diffStat: diffStatFromFiles(input.files),
    receipts: input.receipts,
    ticketId: input.ticketId ?? null,
    leverage: LEVERAGE_RANK[input.kind],
    createdAt: input.createdAt,
  };
}

/**
 * Sorts cards by leverage descending (merges → approvals → clarifications
 * → digests), tie-broken oldest-first so cards of equal leverage present in
 * the order they were parked. Does not mutate the input array.
 */
export function buildQueueProjection(
  cards: readonly ReviewCard[],
): readonly ReviewCard[] {
  return [...cards].sort((a, b) => {
    if (b.leverage !== a.leverage) return b.leverage - a.leverage;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
