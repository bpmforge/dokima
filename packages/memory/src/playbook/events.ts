/**
 * R0 consult hit/miss events (FR-M2's acceptance sketch: "R0 hit on a
 * repeated fixture task skips the model call"). Mirrors
 * `packages/gateway/src/escalation/events.ts`'s injectable-sink pattern:
 * this package can't depend on `@shipwright/events` (no `package.json`
 * dependency declared within this ticket's write_scope), so events are
 * minted here and handed to a caller-supplied sink wired to the real event
 * log elsewhere. Distinct namespace from gateway's `escalation.*` events —
 * those record rung transitions; these record whether the memory layer
 * itself had an answer, which is the fact this ticket's write_scope owns.
 */

export type PlaybookConsultEventType = 'playbook.r0_hit' | 'playbook.r0_miss';

export interface PlaybookConsultEvent {
  readonly type: PlaybookConsultEventType;
  readonly ticketId: string;
  readonly criterion: string;
  /** Which source answered — absent on a miss. */
  readonly source?: 'playbook' | 'fact';
  readonly findingId?: string;
  readonly occurredAt: string;
}

export interface PlaybookConsultSink {
  emit(event: PlaybookConsultEvent): void | Promise<void>;
}

export const noopPlaybookConsultSink: PlaybookConsultSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt
    // out explicitly by omitting a sink; production call sites pass a real
    // one wired to packages/events.
  },
};

export function createInMemoryPlaybookConsultSink(): PlaybookConsultSink & {
  events: PlaybookConsultEvent[];
} {
  const events: PlaybookConsultEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
