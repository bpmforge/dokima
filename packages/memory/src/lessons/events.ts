/**
 * Field-report lifecycle events (BLUEPRINT §12.6). Mirrors
 * `../playbook/events.ts`'s injectable-sink pattern: this package can't
 * depend on `@dokima/events` (no `package.json` dependency declared
 * within this ticket's write_scope), so events are minted here and handed to
 * a caller-supplied sink wired to the real event log elsewhere. Distinct
 * namespace from `playbook.*` (R0 consult) and `escalation.*` (ladder rung
 * transitions) — these record the intake/triage lifecycle itself.
 */

export type LessonsEventType = 'lessons.filed' | 'lessons.triaged';

export interface LessonsEvent {
  readonly type: LessonsEventType;
  readonly reportId: number;
  readonly actorId: string;
  /** Present only on `lessons.triaged` — the outcome of the triage decision. */
  readonly outcome?: 'accepted_playbook' | 'accepted_ticket' | 'rejected';
  readonly occurredAt: string;
}

export interface LessonsEventSink {
  emit(event: LessonsEvent): void | Promise<void>;
}

export const noopLessonsEventSink: LessonsEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt
    // out explicitly by omitting a sink; production call sites pass a real
    // one wired to packages/events.
  },
};

export function createInMemoryLessonsEventSink(): LessonsEventSink & {
  events: LessonsEvent[];
} {
  const events: LessonsEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
