import { useEffect, useState } from 'react';
import type { BoardApiOptions } from '../api.js';
import { formatHeartbeat } from '../heartbeat.js';
import type { HeartbeatData } from '../types.js';
import { fetchRunTrace, fetchSpendByRung, fetchTicketRuns } from './api.js';
import { SpendByRung } from './SpendByRung.js';
import type { SpendByRung as SpendByRungData, TraceEvent } from './types.js';
import { FileFieldReportAction } from '../../lessons/FileFieldReportAction.js';
import { describeTraceEvent } from '../../trace/classify.js';
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

  // Review T1: each read rejects on a non-2xx and nothing caught it, so a
  // failure showed "Loading…" forever. Now: an error with Retry.
  const [spendError, setSpendError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<{ runId: string; message: string } | null>(
    null,
  );
  const [spendAttempt, setSpendAttempt] = useState(0);
  const [runsAttempt, setRunsAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSpend(null);
    setSpendError(null);
    fetchSpendByRung(apiOpts, projectId)
      .then((data) => {
        if (!cancelled) setSpend(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSpendError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [apiOpts, projectId, spendAttempt]);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setRunsError(null);
    setTrace(null);
    setTraceError(null);
    fetchTicketRuns(apiOpts, projectId, ticketId)
      .then((items) => {
        if (!cancelled) setRuns(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRunsError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [apiOpts, projectId, ticketId, runsAttempt]);

  const openTrace = (runId: string) => {
    setTraceError(null);
    fetchRunTrace(apiOpts, projectId, runId, ticketId)
      .then((events) => setTrace({ runId, events }))
      .catch((err: unknown) => setTraceError({ runId, message: errorText(err) }));
  };

  return (
    <section aria-label="Telemetry" data-testid="drawer-telemetry">
      <h3>Live loop telemetry</h3>
      <p data-testid="drawer-heartbeat">
        {heartbeat
          ? formatHeartbeat(heartbeat)
          : 'No agent is working this ticket right now — this fills in live while a run holds it.'}
      </p>

      <h3>Spend by rung</h3>
      {/* W13-60: 'rung' defined where a person first meets it (VOCABULARY.md
          rule). A rung is a step on the ladder of models. */}
      <p className="ticket-drawer__hint" data-testid="spend-rung-hint">
        A rung is one step on the ladder of models — runs start on the
        cheapest rung and climb only when work stalls.
      </p>
      {spendError !== null ? (
        <div role="alert" data-testid="spend-by-rung-error">
          <p>Couldn&apos;t load spend: {spendError}</p>
          <button type="button" onClick={() => setSpendAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : (
        <SpendByRung data={spend} />
      )}

      <h3>Session trace</h3>
      {traceError !== null && (
        <div role="alert" data-testid="session-trace-error">
          <p>Couldn&apos;t load the trace for {traceError.runId}: {traceError.message}</p>
          <button type="button" onClick={() => openTrace(traceError.runId)}>
            Retry
          </button>
        </div>
      )}
      {runsError !== null ? (
        <div role="alert" data-testid="session-trace-error">
          <p>Couldn&apos;t load the session trace: {runsError}</p>
          <button type="button" onClick={() => setRunsAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : runs === null ? (
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
                  {describeTraceEvent(event.event_type)} ·{' '}
                  <span className="ticket-drawer__wire-id">{event.event_type}</span> ·{' '}
                  {event.actor_id} · {event.created_at}
                  <FileFieldReportAction
                    apiOpts={apiOpts}
                    projectId={projectId}
                    draft={draftFromEscalationEvent(escalationLikeFromTraceEvent(event))}
                  />
                </li>
              ) : (
                <li key={event.seq} data-testid="trace-event-row">
                  {describeTraceEvent(event.event_type)} ·{' '}
                  <span className="ticket-drawer__wire-id">{event.event_type}</span> ·{' '}
                  {event.actor_id} · {event.created_at}
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
