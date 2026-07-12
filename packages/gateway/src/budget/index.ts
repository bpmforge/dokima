/**
 * Barrel for the budget module (FR-G4, FR-H5). NOTE: not re-exported from
 * packages/gateway/src/index.ts — that file is out of this ticket's
 * write_scope (packages/gateway/src/budget/** only), same gap prior
 * gateway tickets (W2-01/02/04/05/06) left for their own modules. Tests
 * are co-located `*.test.ts` per docs/TESTING.md §2.
 */

export type {
  ApprovalCard,
  ApprovalCardRiskClass,
  BreakerLevel,
  BreakerReading,
  BreakerScope,
  BudgetLimits,
  BudgetPolicy,
  LedgerEntry,
  LedgerKey,
} from './types.js';
export { BREAKER_LEVEL_ORDER, BREAKER_THRESHOLDS } from './types.js';

export { CostLedger } from './ledger.js';

export { BudgetBreakerTracker, policyForLevel, readBreaker } from './breakers.js';

export type {
  BudgetEvent,
  BudgetEventSink,
  BudgetEventType,
  NotificationTier,
} from './events.js';
export { createInMemoryBudgetEventSink, noopBudgetEventSink } from './events.js';
