/**
 * W19-04 — one screen says what the run did.
 *
 * A finished run used to scatter its evidence: closes on the board, parks in
 * card comments, spend in settings, the gate verdict in the morning queue.
 * This card derives everything from the run's OWN slice of the append-only
 * event log (`GET /runs/:id/trace`) — a projection, no new writable state:
 *
 *   closed  = distinct tickets with a `ticket.closed` event in this run
 *   parked  = distinct tickets whose park comment (the same W13-63 markers
 *             the card face reads) landed in this run, with the one-line why
 *   spend   = the run's `spend.recorded` events, summed
 *   gate    = the W19-01 `phase.advanced` event, or its refusal notification
 */
import { useEffect, useState } from 'react';
import type { BoardApiOptions } from './api.js';
import { fetchRunTraceAll } from './drawer/api.js';
import type { TraceEvent } from './drawer/types.js';

const PARK_MARKERS = ['Parked with evidence', 'auto-blocked with evidence'];

export interface RunSummaryData {
  readonly closed: readonly string[];
  readonly parked: readonly { ticketId: string; reason: string }[];
  readonly spendUsd: number;
  readonly phaseLine: string | null;
}

export function summarizeRun(events: readonly TraceEvent[]): RunSummaryData {
  const closed = new Set<string>();
  const parked = new Map<string, string>();
  let spendUsd = 0;
  let phaseLine: string | null = null;

  for (const event of events) {
    if (event.event_type === 'ticket.closed' && event.ticket_id) {
      closed.add(event.ticket_id);
      parked.delete(event.ticket_id);
    }
    if (event.event_type === 'ticket.commented' && event.ticket_id) {
      const body = String((event.payload as { body?: unknown } | null)?.body ?? '');
      if (PARK_MARKERS.some((m) => body.startsWith(m))) {
        const lines = body.split('\n');
        const reason = (lines[1] ?? lines[0] ?? '')
          .replace(/^attempt \d+\/\d+:\s*/, '')
          .trim();
        parked.set(event.ticket_id, reason);
      }
    }
    if (event.event_type === 'spend.recorded') {
      const cost = (event.payload as { costUsd?: unknown } | null)?.costUsd;
      if (typeof cost === 'number' && Number.isFinite(cost)) spendUsd += cost;
    }
    if (event.event_type === 'phase.advanced') {
      const p = event.payload as { from?: number; to?: number } | null;
      phaseLine = `Phase gate passed — the project advanced from phase ${String(p?.from)} to ${String(p?.to)}.`;
    }
  }
  return {
    closed: [...closed],
    parked: [...parked.entries()].map(([ticketId, reason]) => ({ ticketId, reason })),
    spendUsd,
    phaseLine,
  };
}

export interface RunSummaryProps {
  readonly apiOpts: BoardApiOptions;
  readonly projectId: string;
  readonly runId: string;
}

export function RunSummary({ apiOpts, projectId, runId }: RunSummaryProps) {
  const [data, setData] = useState<RunSummaryData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRunTraceAll(apiOpts, projectId, runId)
      .then((events) => {
        if (!cancelled) setData(summarizeRun(events));
      })
      .catch(() => {
        // The banner above already carries the run's outcome line; a summary
        // that cannot load simply does not render — never a second error.
      });
    return () => {
      cancelled = true;
    };
    // apiOpts is rebuilt per render; keying on its parts avoids a refetch loop.
  }, [apiOpts.baseUrl, apiOpts.token, projectId, runId]);

  if (!data) return null;
  return (
    <div className="surface board-view__run-summary" data-testid="run-summary">
      <h4>What this run did</h4>
      <p data-testid="run-summary-counts">
        {data.closed.length} ticket{data.closed.length === 1 ? '' : 's'} closed ·{' '}
        {data.parked.length} parked · ${data.spendUsd.toFixed(2)} spent
      </p>
      {data.parked.length > 0 && (
        <ul data-testid="run-summary-parked">
          {data.parked.map((p) => (
            <li key={p.ticketId}>
              <strong>{p.ticketId}</strong> parked — {p.reason}
            </li>
          ))}
        </ul>
      )}
      {data.phaseLine && <p data-testid="run-summary-phase">{data.phaseLine}</p>}
    </div>
  );
}
