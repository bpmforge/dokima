/**
 * Barrel for the limits module (FR-G8). NOTE: not re-exported from
 * packages/gateway/src/index.ts — that file is out of this ticket's write_scope
 * (packages/gateway/src/limits/** only), the same gap ../budget/index.ts documents for its own
 * module (a later ticket widened that export; the same applies here). Tests are co-located
 * *.test.ts per docs/TESTING.md §2.
 */

export type { ProviderErrorClass, ProviderErrorClassification } from './types.js';

export { parseResetTimestamp } from './reset-time.js';

export { classifyProviderError } from './classify.js';

export type {
  LimitEvent,
  LimitEventSink,
  LimitEventType,
  LimitNotificationTier,
  LimitPauseEvent,
  LimitResumeEvent,
  LimitResumeSource,
} from './events.js';
export { createInMemoryLimitEventSink, noopLimitEventSink } from './events.js';
