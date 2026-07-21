import { useEffect, useState } from 'react';
import type { BoardApiOptions } from '../board/api.js';
import { FileFieldReportAction } from '../lessons/FileFieldReportAction.js';
import {
  draftFromEscalationEvent,
  draftFromTraceEvent,
  type EscalationEventLike,
} from '../lessons/prefill.js';
import { fetchRunTrace, fetchTicketRuns, type TraceEvent } from './api.js';
import { classifyTraceEvent, passNumber, TRACE_EVENT_KIND_LABEL } from './classify.js';
import './trace.css';

/**
 * Duplicated (not imported) from `TelemetryPanel.tsx`'s identical helper:
 * that file is outside this ticket's write_scope (W7-05) and doesn't
 * export it. Same escalation-payload shape either way (`packages/gateway/
 * src/escalation/events.ts`'s `EscalationEvent`, camelCased over the wire).
 */
function escalationLikeFromTraceEvent(event: TraceEvent): EscalationEventLike {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  return {
    type: event.event_type,
    ticketId: event.ticket_id ?? '',
    fromRung: typeof payload.fromRung === 'string' ? payload.fromRung : undefined,
    toRung: typeof payload.toRung === 'string' ? payload.toRung : undefined,
    actorId: event.actor_id,
    receiptId: typeof payload.receiptId === 'string' ? payload.receiptId : undefined,
    occurredAt: event.created_at,
  };
}

export interface TraceViewProps {
  apiOpts: BoardApiOptions;
  projectId: string;
  ticketId: string;
  onClose: () => void;
}

/**
 * Dedicated session-trace replay surface (BLUEPRINT §12.4, this ticket's
 * own `apps/web/src/trace/**` scope) — the debugging surface for "why did
 * this ticket block?", reachable from a ticket card via the drawer
 * (`App.tsx`'s portal into `[data-testid="ticket-drawer"]`, since
 * `Card.tsx`/`TicketDrawer.tsx` are outside this ticket's write_scope).
 * Every event row carries a "File field report" action pre-filled from
 * that event (UX_SPEC §7 G-10c) — the trace view feeding the lessons form.
 */
export function TraceView({ apiOpts, projectId, ticketId, onClose }: TraceViewProps) {
  const [runs, setRuns] = useState<string[] | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [events, setEvents] = useState<TraceEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setSelectedRun(null);
    setEvents(null);
    void fetchTicketRuns(apiOpts, projectId, ticketId).then((items) => {
      if (!cancelled) setRuns(items);
    });
    return () => {
      cancelled = true;
    };
  }, [apiOpts, projectId, ticketId]);

  useEffect(() => {
    if (!selectedRun) return;
    let cancelled = false;
    setEvents(null);
    void fetchRunTrace(apiOpts, projectId, selectedRun, ticketId).then((items) => {
      if (!cancelled) setEvents(items);
    });
    return () => {
      cancelled = true;
    };
  }, [apiOpts, projectId, selectedRun, ticketId]);

  return (
    <section
      className="trace-view"
      aria-label={`Session trace for ${ticketId}`}
      data-testid="trace-view"
    >
      <header className="trace-view__header">
        <h2>Session trace — {ticketId}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      {runs === null ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p className="trace-view__empty" data-testid="trace-view-empty">
          No session trace yet — this ticket hasn&apos;t been worked by an autonomous run.
        </p>
      ) : selectedRun && events ? (
        <>
          <button type="button" onClick={() => setSelectedRun(null)}>
            ← Back to runs
          </button>
          <ol className="trace-view__events" data-testid="trace-view-events">
            {events.map((event) => {
              const kind = classifyTraceEvent(event.event_type);
              const pass = passNumber(event.payload);
              return (
                <li
                  key={event.seq}
                  className={`trace-event trace-event--${kind}`}
                  data-testid="trace-view-event-row"
                >
                  <span className="trace-event__kind">
                    {TRACE_EVENT_KIND_LABEL[kind]}
                  </span>
                  {pass !== null && (
                    <span className="trace-event__pass">Pass {pass}</span>
                  )}
                  <span className="trace-event__type">{event.event_type}</span>
                  <span className="trace-event__actor">{event.actor_id}</span>
                  <span className="trace-event__time">{event.created_at}</span>
                  <FileFieldReportAction
                    apiOpts={apiOpts}
                    projectId={projectId}
                    draft={
                      kind === 'escalation'
                        ? draftFromEscalationEvent(escalationLikeFromTraceEvent(event))
                        : draftFromTraceEvent(event)
                    }
                  />
                </li>
              );
            })}
          </ol>
        </>
      ) : selectedRun ? (
        <p>Loading…</p>
      ) : (
        <ul className="trace-view__runs" data-testid="trace-view-runs">
          {runs.map((runId) => (
            <li key={runId}>
              <button type="button" onClick={() => setSelectedRun(runId)}>
                View session trace — {runId}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
