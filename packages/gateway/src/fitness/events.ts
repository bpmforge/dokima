/**
 * Fitness ack events (FR-G6: "proceeding requires explicit ack event").
 * Mirrors routing/maker-verifier.ts and budget/events.ts's injectable-sink
 * pattern: this package cannot depend on packages/events from this
 * ticket's write_scope, so the event is minted here and handed to a
 * caller-supplied sink wired to the real event log elsewhere.
 */

import type { AgentRole, FitnessCard, FitnessVerdict } from './types.js';

export interface FitnessAckEvent {
  readonly type: 'fitness.unfit_ack';
  readonly model: string;
  readonly role: AgentRole;
  readonly verdict: FitnessVerdict;
  readonly card: FitnessCard;
  readonly actorId: string;
  readonly occurredAt: string;
}

export interface FitnessEventSink {
  emit(event: FitnessAckEvent): void | Promise<void>;
}

export const noopFitnessEventSink: FitnessEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt out
    // explicitly by omitting a sink; production call sites must pass a real one
    // wired to packages/events.
  },
};

export function createInMemoryFitnessEventSink(): FitnessEventSink & {
  events: FitnessAckEvent[];
} {
  const events: FitnessAckEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
