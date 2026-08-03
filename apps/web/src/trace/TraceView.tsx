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

/** `payload.reason` on an `escalation.*` event (seed-tour-trace.mjs's "validator gap persisted") — not part of `EscalationEventLike` (that shape only carries what the field-report draft needs), so read separately. */
function escalationReason(event: TraceEvent): string | undefined {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  return typeof payload.reason === 'string' ? payload.reason : undefined;
}

/** Mirrors `apps/web/src/artifacts/types.ts`'s `ReceiptValidatorResult` (that module is outside this ticket's write_scope) — the shape of a `gate.receipt_minted` event's `payload.validators`. */
interface TraceValidatorResult {
  name: string;
  exitCode: number;
  gapCount: number;
}

function isValidatorResult(value: unknown): value is TraceValidatorResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.exitCode === 'number' &&
    typeof record.gapCount === 'number'
  );
}

/** `payload.validators` on a `gate.*` event (BLUEPRINT §12.4's "gate results per pass"). */
function gateValidators(event: TraceEvent): TraceValidatorResult[] {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  return Array.isArray(payload.validators)
    ? payload.validators.filter(isValidatorResult)
    : [];
}

/** `toLocaleString()` (same precedent as `NotificationCard.tsx`'s timestamp) plus the gap since the previous row in the replay — the fixture's ~1ms spacing is real data, not a bug to paper over. */
function formatEventTime(iso: string, previousIso: string | undefined): string {
  const localized = new Date(iso).toLocaleString();
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
              const validators = gateValidators(event);
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
                  <span className="trace-event__type">{event.event_type}</span>
                  {kind === 'escalation' &&
                    (escalation.fromRung || escalation.toRung || reason) && (
                      <span
                        className="trace-event__escalation-detail"
                        data-testid="trace-event-escalation-detail"
                      >
                        {escalation.fromRung && escalation.toRung
                          ? `${escalation.fromRung} → ${escalation.toRung}`
                          : null}
                        {escalation.fromRung && escalation.toRung && reason
                          ? ' — '
                          : null}
                        {reason}
                      </span>
                    )}
                  {kind === 'gate' && validators.length > 0 && (
                    <ul
                      className="trace-event__validators"
                      data-testid="trace-event-validators"
                    >
                      {validators.map((validator) => (
                        <li key={validator.name}>
                          {validator.name}: exit {validator.exitCode} ·{' '}
                          {validator.gapCount} gap{validator.gapCount === 1 ? '' : 's'}
                        </li>
                      ))}
                    </ul>
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
