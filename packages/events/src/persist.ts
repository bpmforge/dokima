import { appendEvent, listEvents } from './append.js';
import type { EventLog, EventRecord } from './types.js';

interface ResolutionPayload {
  startedSeq?: number;
}

function operationOf(eventType: string, suffix: string): string | null {
  return eventType.endsWith(suffix) ? eventType.slice(0, -suffix.length) : null;
}

export interface PersistBeforeExecuteOptions {
  log: EventLog;
  /** Base event type, e.g. `ticket.claim` — started/completed/failed are appended around it. */
  operation: string;
  actorId: string;
  ticketId?: string | null;
  runId?: string | null;
  payload?: unknown;
  now?: () => string;
}

/**
 * Crash-safe wrapper (NFR-3): persists intent (`<operation>.started`) before
 * running `execute`, then persists the outcome. If the process dies between
 * the two appends, `sweepOrphans` resolves the dangling `.started` event on
 * next open — nothing is left claiming to be in-flight forever.
 */
export function persistBeforeExecute<T>(
  opts: PersistBeforeExecuteOptions,
  execute: () => T,
): T {
  const started = appendEvent(
    opts.log,
    {
      eventType: `${opts.operation}.started`,
      actorId: opts.actorId,
      ticketId: opts.ticketId,
      runId: opts.runId,
      payload: opts.payload ?? null,
    },
    { now: opts.now },
  );
  try {
    const result = execute();
    appendEvent(
      opts.log,
      {
        eventType: `${opts.operation}.completed`,
        actorId: opts.actorId,
        ticketId: opts.ticketId,
        runId: opts.runId,
        payload: { startedSeq: started.seq } satisfies ResolutionPayload,
      },
      { now: opts.now },
    );
    return result;
  } catch (err) {
    appendEvent(
      opts.log,
      {
        eventType: `${opts.operation}.failed`,
        actorId: opts.actorId,
        ticketId: opts.ticketId,
        runId: opts.runId,
        payload: {
          startedSeq: started.seq,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ResolutionPayload & { error: string },
      },
      { now: opts.now },
    );
    throw err;
  }
}

export interface SweepOrphansOptions {
  now?: () => string;
}

/**
 * Orphan sweep (NFR-3, run on open): finds every `<op>.started` event with
 * no matching `.completed` / `.failed` / `.orphaned` resolution and appends
 * `<op>.orphaned` for it, attributed to `systemActorId`. Resolution never
 * mutates the original event — the log stays append-only; it just closes
 * out the transient state so no record stays "in flight" past a crash.
 */
export function sweepOrphans(
  log: EventLog,
  systemActorId: string,
  opts: SweepOrphansOptions = {},
): EventRecord[] {
  const events = listEvents(log);
  const resolvedStartSeqs = new Set<number>();
  for (const event of events) {
    const isResolution =
      operationOf(event.eventType, '.completed') !== null ||
      operationOf(event.eventType, '.failed') !== null ||
      operationOf(event.eventType, '.orphaned') !== null;
    if (!isResolution) continue;
    const payload = event.payload as ResolutionPayload | null;
    if (payload && typeof payload.startedSeq === 'number') {
      resolvedStartSeqs.add(payload.startedSeq);
    }
  }

  const orphaned: EventRecord[] = [];
  for (const event of events) {
    const operation = operationOf(event.eventType, '.started');
    if (operation === null || resolvedStartSeqs.has(event.seq)) continue;
    const record = appendEvent(
      log,
      {
        eventType: `${operation}.orphaned`,
        actorId: systemActorId,
        ticketId: event.ticketId,
        runId: event.runId,
        payload: {
          startedSeq: event.seq,
          reason: 'crash-recovery-sweep',
        } satisfies ResolutionPayload & {
          reason: string;
        },
      },
      { now: opts.now },
    );
    orphaned.push(record);
  }
  return orphaned;
}
