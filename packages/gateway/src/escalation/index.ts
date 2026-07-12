/**
 * Barrel for the escalation module (FR-G3). NOTE: not re-exported from
 * packages/gateway/src/index.ts — that file is out of this ticket's
 * write_scope (packages/gateway/src/escalation/** only), same gap prior
 * gateway tickets (W2-01/02/04/05) left for their own modules. Tests are
 * co-located `*.test.ts` per docs/TESTING.md §2.
 */

export type { FailureReceipt, GateOutcome, Rung } from './types.js';
export { RUNG_ORDER } from './types.js';

export type {
  MemoryConsultHook,
  MemoryConsultInput,
  MemoryConsultResult,
} from './memory-hook.js';
export { noopMemoryConsultHook } from './memory-hook.js';

export type {
  EscalationEvent,
  EscalationEventSink,
  EscalationEventType,
} from './events.js';
export { createInMemoryEscalationEventSink, noopEscalationEventSink } from './events.js';

export type {
  AttemptRunner,
  EscalationLadderInput,
  EscalationLadderOutcome,
  EscalationLadderStatus,
  RungAttemptContext,
  RungAttemptRecord,
  RungAttemptStatus,
} from './ladder.js';
export {
  MissingFailureEvidenceError,
  isMonotonicRungSequence,
  runEscalationLadder,
} from './ladder.js';
