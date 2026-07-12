/**
 * Budget breaker events (FR-G4): every threshold crossing is ledgered — 70%
 * (`budget.threshold_crossed`) and 85% (`budget.downshift`) are Record
 * tier, feed-only, never pop (docs/design/UX_SPEC.md §7); 100%
 * (`budget.hard_stop`) is Decide tier and carries an approval card
 * (US-243's 'budget' risk class). Mirrors escalation/events.ts's
 * injectable-sink pattern: this package cannot depend on packages/events
 * from this ticket's write_scope, so events are minted here and handed to
 * a caller-supplied sink wired to the real event log elsewhere.
 */

import type { ApprovalCard, BreakerScope } from './types.js';

export type BudgetEventType =
  'budget.threshold_crossed' | 'budget.downshift' | 'budget.hard_stop';

export type NotificationTier = 'record' | 'decide';

export interface BudgetEvent {
  readonly type: BudgetEventType;
  readonly tier: NotificationTier;
  readonly scope: BreakerScope;
  readonly projectId: string;
  readonly runId: string;
  readonly thresholdPct: 70 | 85 | 100;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly ratio: number;
  /** Only present on 'budget.hard_stop' (US-243: 100% raises a Decide-tier approval card). */
  readonly approvalCard?: ApprovalCard;
  readonly occurredAt: string;
}

export interface BudgetEventSink {
  emit(event: BudgetEvent): void | Promise<void>;
}

export const noopBudgetEventSink: BudgetEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt out
    // explicitly by omitting a sink; production call sites must pass a real one
    // wired to packages/events.
  },
};

export function createInMemoryBudgetEventSink(): BudgetEventSink & {
  events: BudgetEvent[];
} {
  const events: BudgetEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
