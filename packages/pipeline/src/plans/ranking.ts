/**
 * Deterministic plan_item ranking (FR-PLAN2, DATABASE.md §5b `rank INTEGER
 * (deterministic)`): `severity × leverage × staleness`. Same snapshot +
 * same `asOf` clock ⇒ same rank, always (property-tested in
 * ranking.property.test.ts).
 */

import type { PlanItemRecord } from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Days elapsed between `firstSeenAt` and `asOf`, floored at 1 so a
 * freshly-proposed item still ranks by severity × leverage rather than
 * zeroing out (a brand-new item isn't "worthless", it just hasn't aged).
 * Clock skew (asOf before firstSeenAt) also floors at 1 rather than going
 * negative.
 */
export function computeStalenessDays(firstSeenAt: string, asOf: string): number {
  const firstMs = Date.parse(firstSeenAt);
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(firstMs) || !Number.isFinite(asOfMs)) {
    throw new RangeError(`invalid timestamp: firstSeenAt=${firstSeenAt} asOf=${asOf}`);
  }
  const days = Math.floor((asOfMs - firstMs) / MS_PER_DAY);
  return Math.max(1, days + 1);
}

export function computeRank(
  severity: number,
  leverage: number,
  staleness: number,
): number {
  return severity * leverage * staleness;
}

/**
 * Recomputes `rank` for every item as of `asOf` and returns them sorted
 * descending by rank. Ties break on `catalogId` ascending, then `id`
 * ascending — total order, so two evaluations of the same input always
 * agree, even when ranks collide (FR-PLAN2 "same snapshot ⇒ same ranking").
 */
export function rankItems(
  items: readonly PlanItemRecord[],
  asOf: string,
): readonly PlanItemRecord[] {
  const withRank = items.map((item) => ({
    ...item,
    rank: computeRank(
      item.severity,
      item.leverage,
      computeStalenessDays(item.firstSeenAt, asOf),
    ),
  }));
  return withRank.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (a.catalogId !== b.catalogId) return a.catalogId.localeCompare(b.catalogId);
    return a.id.localeCompare(b.id);
  });
}
