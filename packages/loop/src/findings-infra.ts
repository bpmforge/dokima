/**
 * Infra-failure taxonomy (CODE_BOOK_PROTOCOL chapter of findings.ts — R-D2): a truncated
 * review, an unparseable verdict, a provider-limit pause, a watchdog kill, or an output-buffer
 * overflow retries the review for free. This tracker is deliberately independent of
 * FindingLedger and RuleStateStore (findings-ledger.ts / findings-rules.ts) — recording an
 * infra event can never open a finding, consume an attempt, or move an FP-rate metric.
 */

export type InfraFailureKind =
  | 'unparseable_review'
  | 'limit_pause'
  | 'watchdog_kill'
  | 'output_buffer_overflow'
  /**
   * W13-27: the model endpoint failed — unreachable, or it stopped producing
   * and the stream was aborted. Added when this taxonomy got its first caller.
   *
   * It belongs here for the same reason as the four above: none of them is
   * evidence the WORK is wrong, so none should cost an attempt. An endpoint
   * that stalls says nothing about the code a session did or did not write.
   */
  | 'endpoint_failure';

export const INFRA_FAILURE_KINDS: readonly InfraFailureKind[] = [
  'unparseable_review',
  'limit_pause',
  'watchdog_kill',
  'output_buffer_overflow',
  'endpoint_failure',
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
    endpoint_failure: 0,
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
