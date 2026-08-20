import { useEffect, useState } from 'react';
import type { BoardApiOptions } from '../board/api.js';
import { FileFieldReportAction } from '../lessons/FileFieldReportAction.js';
import {
  draftFromEscalationEvent,
  draftFromTraceEvent,
  type EscalationEventLike,
} from '../lessons/prefill.js';
import { formatTimestamp } from '../notifications/NotificationCard.js';
import { fetchRunTrace, fetchTicketRuns, type TraceEvent } from './api.js';
import {
  classifyTraceEvent,
  describeTraceEvent,
  passNumber,
  RUNG_DEFINITION,
  TRACE_EVENT_KIND_LABEL,
} from './classify.js';
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

/**
 * `payload.reason` on an `escalation.*` event. Unlike `fromRung`/`toRung`
 * (typed and set at the real emit site, `escalation/policy.ts:313-314` and
 * `escalation/events.ts:17-18`), no production emitter types or sets a
 * `reason` field — it appears only in `seed-tour-trace.mjs`'s fixture.
 * Read defensively and rendered only when present, same as any other
 * untrusted payload key; never assumed to exist.
 */
function escalationReason(event: TraceEvent): string | undefined {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  return typeof payload.reason === 'string' ? payload.reason : undefined;
}

/**
 * Gate rows deliberately do NOT surface `payload.validators` (W10-35's
 * corrected criterion): `mintReceipt` (`packages/events/src/receipts.ts:
 * 363-372`) is the sole appender of `gate.receipt_minted`/`gate.waived` and
 * anchors them with `payload: { receiptId, kind, contentMac }` only —
 * validator results live in the separate `receipts` DB table. Surfacing
 * them here would mean fetching the receipt via `GET /api/v1/receipts/:id`
 * (`apps/web/src/artifacts/api.ts`'s `fetchReceipt`), which needs a fetcher
 * in `trace/api.ts` — outside this ticket's write_scope. Left as a
 * follow-up rather than reaching into a sibling feature's API module.
 */

/** `NotificationCard.tsx`'s `formatTimestamp` (W10-28: shared, not duplicated — same precedent that was previously just a comment) plus the gap since the previous row in the replay — the fixture's ~1ms spacing is real data, not a bug to paper over. */
function formatEventTime(iso: string, previousIso: string | undefined): string {
  const localized = formatTimestamp(iso);
  if (previousIso === undefined) return localized;
  const deltaMs = new Date(iso).getTime() - new Date(previousIso).getTime();
  return `${localized} (+${formatStepDelta(deltaMs)})`;
}

function formatStepDelta(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 1000) return `${Math.round(clamped)}ms`;
  if (clamped < 60_000) return `${(clamped / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
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

      {/* W13-60: 'File field report' was the trace's only per-event action
          and nothing said what filing one does. One sentence, once, above
          the rows — not a tooltip per row a novice may never hover. */}
      <p className="trace-view__report-hint" data-testid="trace-view-report-hint">
        Each event offers <strong>File field report</strong>: flag the event so
        the improvement loop learns from it. Filing changes nothing on the
        board — it only records what you saw.
      </p>

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
            {events.map((event, index) => {
              const kind = classifyTraceEvent(event.event_type);
              const pass = passNumber(event.payload);
              const escalation = escalationLikeFromTraceEvent(event);
              const reason = escalationReason(event);
              const previousEvent = index > 0 ? events[index - 1] : undefined;
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
                  {/* W13-60: the human sentence leads; the wire id stays as
                      secondary detail (rename-in-the-UI-only, VOCABULARY.md). */}
                  <span className="trace-event__label">
                    {describeTraceEvent(event.event_type)}
                  </span>
                  <span className="trace-event__type">{event.event_type}</span>
                  {kind === 'escalation' &&
                    (escalation.fromRung || escalation.toRung || reason) && (
                      <span
                        className="trace-event__escalation-detail"
                        data-testid="trace-event-escalation-detail"
                        title={RUNG_DEFINITION}
                      >
                        {escalation.fromRung && escalation.toRung
                          ? `rung ${escalation.fromRung} → ${escalation.toRung}`
                          : null}
                        {escalation.fromRung && escalation.toRung && reason
                          ? ' — '
                          : null}
                        {reason}
                      </span>
                    )}
                  <span className="trace-event__actor">{event.actor_id}</span>
                  <span className="trace-event__time">
                    <time dateTime={event.created_at}>
                      {formatEventTime(event.created_at, previousEvent?.created_at)}
                    </time>
                  </span>
                  <FileFieldReportAction
                    apiOpts={apiOpts}
                    projectId={projectId}
                    draft={
                      kind === 'escalation'
                        ? draftFromEscalationEvent(escalation)
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
