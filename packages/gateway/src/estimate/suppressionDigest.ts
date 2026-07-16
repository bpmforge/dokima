/**
 * Suppression-volume rollup (GATE_ECONOMICS §3: "the weekly digest reports
 * suppression volume per rule (an input to demotion)"). Pure count per
 * `ruleId`, descending — the shape a rule-lifecycle reviewer scans to spot
 * a rule worth investigating for demotion (>50% trailing FP, ADR-16).
 */

import type { SuppressionDigestRow, SuppressionRecord } from './types.js';

export function rollupSuppressionVolume(
  records: readonly SuppressionRecord[],
): SuppressionDigestRow[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.ruleId, (counts.get(record.ruleId) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId));
}
