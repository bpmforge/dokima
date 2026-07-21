/**
 * Field-report prefill (UX_SPEC §7 G-10c: "form pre-filled from the trace").
 * Pure mappers — no DB, no side effects — from a session-trace event or an
 * escalation event into a draft the filer can still edit before submitting.
 * `whatHappened`/`expected` are seeded with a factual placeholder, never
 * fabricated narrative: the filer supplies the actual account.
 */
import type { FieldReportSource } from './types.js';

/** The subset of a session-trace event (`apps/web/src/board/drawer/types.ts`'s `TraceEvent`, reproduced structurally — this package can't import `apps/web`) a prefill needs. */
export interface TraceEventLike {
  readonly seq: number;
  readonly eventType: string;
  readonly actorId: string;
  readonly ticketId: string | null;
  readonly runId: string | null;
  readonly createdAt: string;
}

/** The subset of `packages/gateway/src/escalation/events.ts`'s `EscalationEvent` a prefill needs, reproduced structurally — this package can't depend on `packages/gateway` (ARCHITECTURE §4). */
export interface EscalationEventLike {
  readonly type: string;
  readonly ticketId: string;
  readonly fromRung?: string;
  readonly toRung?: string;
  readonly actorId: string;
  readonly receiptId?: string;
  readonly occurredAt: string;
}

export interface FieldReportDraft {
  readonly ticketId: string | null;
  readonly source: FieldReportSource;
  readonly sourceRef: string | null;
  readonly whatHappened: string;
  readonly expected: string;
  readonly evidenceLinks: readonly string[];
}

/** Prefills from a session-trace event (the "File field report" action on session-trace views). */
export function draftFromTraceEvent(event: TraceEventLike): FieldReportDraft {
  return {
    ticketId: event.ticketId,
    source: 'trace',
    sourceRef: `trace:${event.runId ?? 'unknown'}:${event.seq}`,
    whatHappened: `At ${event.createdAt}, ${event.actorId} produced a "${event.eventType}" event.`,
    expected: '',
    evidenceLinks: event.runId ? [`run:${event.runId}`] : [],
  };
}

/** Prefills from an escalation event (the "File field report" action on escalation event cards). */
export function draftFromEscalationEvent(event: EscalationEventLike): FieldReportDraft {
  const rungNote =
    event.fromRung && event.toRung ? ` (${event.fromRung} -> ${event.toRung})` : '';
  return {
    ticketId: event.ticketId,
    source: 'escalation',
    sourceRef: `escalation:${event.ticketId}:${event.occurredAt}`,
    whatHappened: `Escalation "${event.type}"${rungNote} triggered by ${event.actorId} at ${event.occurredAt}.`,
    expected: '',
    evidenceLinks: event.receiptId ? [`receipt:${event.receiptId}`] : [],
  };
}
