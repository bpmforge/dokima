/**
 * Field-report prefill (UX_SPEC §7 G-10c: "form pre-filled from the trace").
 * Pure mappers — no fetch, no side effects — from a session-trace event or
 * an escalation event into a draft the filer can still edit before
 * submitting. `whatHappened`/`expected` are seeded with a factual
 * placeholder, never fabricated narrative: the filer supplies the actual
 * account. Mirrors `packages/memory/src/lessons/prefill.ts`'s logic
 * client-side — `apps/web` has no workspace package dependencies (fetch-only
 * client, see `apps/web/package.json`), so this can't import that module.
 */
import type { FieldReportDraft } from './types.js';

/** Structurally matches `apps/web/src/board/drawer/types.ts`'s `TraceEvent` — the shape the "File field report" action receives when mounted on a session-trace view. */
export interface TraceEventLike {
  seq: number;
  event_type: string;
  actor_id: string;
  ticket_id: string | null;
  run_id: string | null;
  created_at: string;
}

/** Camel-cased mirror of `packages/gateway/src/escalation/events.ts`'s `EscalationEvent` — the shape the "File field report" action receives when mounted on an escalation event card. */
export interface EscalationEventLike {
  type: string;
  ticketId: string;
  fromRung?: string;
  toRung?: string;
  actorId: string;
  receiptId?: string;
  occurredAt: string;
}

/** Prefills from a session-trace event (the "File field report" action on session-trace views). */
export function draftFromTraceEvent(event: TraceEventLike): FieldReportDraft {
  return {
    ticketId: event.ticket_id,
    source: 'trace',
    sourceRef: `trace:${event.run_id ?? 'unknown'}:${event.seq}`,
    whatHappened: `At ${event.created_at}, ${event.actor_id} produced a "${event.event_type}" event.`,
    expected: '',
    evidenceLinks: event.run_id ? [`run:${event.run_id}`] : [],
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
