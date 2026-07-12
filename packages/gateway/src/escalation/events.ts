/**
 * Escalation events (FR-G3: "every escalation is an event with the failure
 * receipts attached"). Mirrors packages/gateway/src/routing/maker-verifier.ts's
 * injectable-sink pattern: this package cannot depend on packages/events
 * from this ticket's write_scope, so events are minted here and handed to
 * a caller-supplied sink wired to the real event log elsewhere.
 */

import type { FailureReceipt, Rung } from './types.js';

/** `rung_advanced` covers R1->R2 and R2->R3; `blocked` covers R3->R4 (BLUEPRINT §3.3's R4). */
export type EscalationEventType = 'escalation.rung_advanced' | 'escalation.blocked';

export interface EscalationEvent {
  readonly type: EscalationEventType;
  readonly ticketId: string;
  readonly fromRung: Rung;
  readonly toRung: Rung;
  readonly actorId: string;
  /** The failure receipts that triggered this escalation — never empty (see MissingFailureEvidenceError in ladder.ts). */
  readonly receipts: readonly FailureReceipt[];
  readonly occurredAt: string;
}

export interface EscalationEventSink {
  emit(event: EscalationEvent): void | Promise<void>;
}

export const noopEscalationEventSink: EscalationEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt out
    // explicitly by omitting a sink; production call sites must pass a real one
    // wired to packages/events.
  },
};

export function createInMemoryEscalationEventSink(): EscalationEventSink & {
  events: EscalationEvent[];
} {
  const events: EscalationEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
