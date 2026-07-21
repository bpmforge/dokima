import { useEffect, useState } from 'react';
import type { BoardApiOptions } from '../api.js';
import { formatHeartbeat } from '../heartbeat.js';
import type { HeartbeatData } from '../types.js';
import { fetchRunTrace, fetchSpendByRung, fetchTicketRuns } from './api.js';
import { SpendByRung } from './SpendByRung.js';
import type { SpendByRung as SpendByRungData, TraceEvent } from './types.js';
import { FileFieldReportAction } from '../../lessons/FileFieldReportAction.js';
import {
  draftFromEscalationEvent,
  draftFromTraceEvent,
  type EscalationEventLike,
} from '../../lessons/prefill.js';

/**
 * No producer in this codebase wires `packages/gateway/src/escalation`'s
 * `EscalationEventSink` to a real project's event log yet
 * (`apps/server/src/api/roster-history.ts`'s own header documents this
 * gap) — when one lands, an escalation event arrives here as an ordinary
 * `TraceEvent` whose `event_type` is `escalation.rung_advanced` /
 * `escalation.blocked` (`roster-history.ts`'s `classify` already keys off
 * that exact prefix). Rendering those rows as escalation event cards
 * inline in the same session-trace list — rather than standing up a
 * separate, currently-dataless escalation feed — is what makes the "File
 * field report" action on escalation event cards (UX_SPEC §7 G-10c) a real
 * entry point today instead of a card with nothing to show.
 */
const ESCALATION_EVENT_PREFIX = 'escalation.';

function isEscalationEvent(event: TraceEvent): boolean {
  return event.event_type.startsWith(ESCALATION_EVENT_PREFIX);
}

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

export interface TelemetryPanelProps {
  apiOpts: BoardApiOptions;
  projectId: string;
  ticketId: string;
  heartbeat: HeartbeatData | undefined;
}

/** Live loop telemetry + spend-by-rung + session-trace link (UX_SPEC §4). */
export function TelemetryPanel({
  apiOpts,
  projectId,
  ticketId,
  heartbeat,
}: TelemetryPanelProps) {
  const [spend, setSpend] = useState<SpendByRungData | null>(null);
  const [runs, setRuns] = useState<string[] | null>(null);
  const [trace, setTrace] = useState<{ runId: string; events: TraceEvent[] } | null>(
    null,
  );

  useEffect(() => {
    setSpend(null);
    void fetchSpendByRung(apiOpts, projectId).then(setSpend);
  }, [apiOpts, projectId]);

  useEffect(() => {
    setRuns(null);
    setTrace(null);
    void fetchTicketRuns(apiOpts, projectId, ticketId).then(setRuns);
  }, [apiOpts, projectId, ticketId]);

  const openTrace = (runId: string) => {
    void fetchRunTrace(apiOpts, projectId, runId, ticketId).then((events) =>
      setTrace({ runId, events }),
    );
  };

  return (
    <section aria-label="Telemetry" data-testid="drawer-telemetry">
      <h3>Live loop telemetry</h3>
      <p data-testid="drawer-heartbeat">
        {heartbeat
          ? formatHeartbeat(heartbeat)
          : 'No active berth on this ticket right now.'}
      </p>

      <h3>Spend by rung</h3>
      <SpendByRung data={spend} />

      <h3>Session trace</h3>
      {runs === null ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p className="ticket-drawer__empty" data-testid="session-trace-empty">
          No session trace yet — this ticket hasn&apos;t been worked by an autonomous run.
        </p>
      ) : trace ? (
        <>
          <button type="button" onClick={() => setTrace(null)}>
            ← Back to runs
          </button>
          <ol data-testid="session-trace-events">
            {trace.events.map((event) =>
              isEscalationEvent(event) ? (
                <li key={event.seq} data-testid="escalation-event-card">
                  {event.event_type} · {event.actor_id} · {event.created_at}
                  <FileFieldReportAction
                    apiOpts={apiOpts}
                    projectId={projectId}
                    draft={draftFromEscalationEvent(escalationLikeFromTraceEvent(event))}
                  />
                </li>
              ) : (
                <li key={event.seq} data-testid="trace-event-row">
                  {event.event_type} · {event.actor_id} · {event.created_at}
                  <FileFieldReportAction
                    apiOpts={apiOpts}
                    projectId={projectId}
                    draft={draftFromTraceEvent(event)}
                  />
                </li>
              ),
            )}
          </ol>
        </>
      ) : (
        <ul data-testid="session-trace-runs">
          {runs.map((runId) => (
            <li key={runId}>
              <button type="button" onClick={() => openTrace(runId)}>
                View session trace — {runId}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
