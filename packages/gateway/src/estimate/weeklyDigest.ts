/**
 * Weekly Review-tier digest card (US-309 AC-1: "weekly digest is
 * Review-tier"; GATE_ECONOMICS §3): combines the escalation-ROI rung
 * groups and the suppression-volume rollup into the one card a Review-tier
 * notification carries (UX_SPEC §7 notification taxonomy).
 */

import { groupSpendByRung } from './escalationRoi.js';
import { rollupSuppressionVolume } from './suppressionDigest.js';
import type { RungLedgerEntry, SuppressionRecord, WeeklyDigestCard } from './types.js';

export function buildWeeklyDigest(
  weekOf: string,
  ledgerEntries: readonly RungLedgerEntry[],
  suppressions: readonly SuppressionRecord[],
  assumptions: readonly string[] = [],
): WeeklyDigestCard {
  const byRung = groupSpendByRung(ledgerEntries);
  return {
    tier: 'review',
    weekOf,
    totalSpendUsd: byRung.reduce((sum, group) => sum + group.totalUsd, 0),
    byRung,
    suppressionVolume: rollupSuppressionVolume(suppressions),
    assumptions,
  };
}
