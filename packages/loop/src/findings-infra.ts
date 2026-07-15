/**
 * Infra-failure taxonomy (CODE_BOOK_PROTOCOL chapter of findings.ts — R-D2): a truncated
 * review, an unparseable verdict, a provider-limit pause, a watchdog kill, or an output-buffer
 * overflow retries the review for free. This tracker is deliberately independent of
 * FindingLedger and RuleStateStore (findings-ledger.ts / findings-rules.ts) — recording an
 * infra event can never open a finding, consume an attempt, or move an FP-rate metric.
 */

export type InfraFailureKind =
  'unparseable_review' | 'limit_pause' | 'watchdog_kill' | 'output_buffer_overflow';

export const INFRA_FAILURE_KINDS: readonly InfraFailureKind[] = [
  'unparseable_review',
  'limit_pause',
  'watchdog_kill',
  'output_buffer_overflow',
];

export interface InfraFailureTracker {
  readonly total: number;
  readonly counts: Readonly<Record<InfraFailureKind, number>>;
  /** Retries the review for free — zero ledger writes; this tracker never touches a FindingLedger. */
  record(kind: InfraFailureKind): void;
}

export function createInfraFailureTracker(): InfraFailureTracker {
  const counts: Record<InfraFailureKind, number> = {
    unparseable_review: 0,
    limit_pause: 0,
    watchdog_kill: 0,
    output_buffer_overflow: 0,
  };
  let total = 0;
  return {
    get total() {
      return total;
    },
    get counts() {
      return { ...counts };
    },
    record(kind) {
      counts[kind] += 1;
      total += 1;
    },
  };
}
