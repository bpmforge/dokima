import { useEffect, useState } from 'react';
import type { BoardApiOptions } from '../api.js';
import { formatHeartbeat } from '../heartbeat.js';
import type { HeartbeatData } from '../types.js';
import { fetchRunTrace, fetchSpendByRung, fetchTicketRuns } from './api.js';
import { SpendByRung } from './SpendByRung.js';
import type { SpendByRung as SpendByRungData, TraceEvent } from './types.js';

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
            {trace.events.map((event) => (
              <li key={event.seq}>
                {event.event_type} · {event.actor_id} · {event.created_at}
              </li>
            ))}
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
