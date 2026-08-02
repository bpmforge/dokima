/**
 * Per-session watchdog core (BLUEPRINT §3.6/§7.1, FR-H2, NFR-3): every
 * agent session the Harbormaster dispatches is bounded by two independent
 * clocks — a hard `maxSessionSeconds` wall-clock ceiling, and a
 * `heartbeatStallSeconds` liveness check (no observed activity for that
 * long means the session tree has hung, even if it hasn't hit the
 * wall-clock ceiling yet). `checkWatchdogBreach` is the pure decision —
 * no timers of its own, so it's directly unit-testable with synthetic
 * clocks; `watchdog-process.ts` is the real poller that calls it and does
 * the actual killing.
 *
 * On a breach, the caller mints a `session.dead_letter` event and then
 * auto-blocks the ticket exactly the way `loop-claim.ts`'s session-cap
 * auto-block already works: an evidence `commentTicket` + `releaseTicket`
 * back to `ready` (WIP=1 requires an owned ticket be released; per
 * BLUEPRINT §10, "blocked-with-evidence" is a badge the board renders on a
 * released ticket with evidence, never a distinct stored status). Both
 * writes happen the instant the breach is detected — before the killed
 * process tree finishes tearing down — so the ticket flips within seconds
 * regardless of how long teardown takes (SRS FR-H2 test sketch: "stalled-
 * heartbeat fixture terminated within threshold and card turns
 * blocked-with-evidence").
 */

import { appendEvent, type EventLog } from '@dokima/events';
import { commentTicket, releaseTicket } from '@dokima/tickets';

export type WatchdogBreachReason = 'max_session_seconds' | 'heartbeat_stall';

export interface WatchdogBreach {
  readonly reason: WatchdogBreachReason;
  readonly elapsedMs: number;
  readonly sinceLastHeartbeatMs: number;
}

export interface WatchdogLimits {
  readonly maxSessionSeconds: number;
  readonly heartbeatStallSeconds: number;
}

export interface WatchdogClockState {
  readonly startedAtMs: number;
  /** Last time activity was observed (e.g. stdout/stderr data). Equals `startedAtMs` before the first heartbeat. */
  readonly lastHeartbeatAtMs: number;
}

/**
 * Pure breach check against two injected timestamps — no timers, no I/O.
 * The wall-clock ceiling is checked first: it is a hard cap regardless of
 * how recently the session heartbeated.
 */
export function checkWatchdogBreach(
  limits: WatchdogLimits,
  state: WatchdogClockState,
  nowMs: number,
): WatchdogBreach | null {
  const elapsedMs = nowMs - state.startedAtMs;
  const sinceLastHeartbeatMs = nowMs - state.lastHeartbeatAtMs;
  if (elapsedMs >= limits.maxSessionSeconds * 1000) {
    return { reason: 'max_session_seconds', elapsedMs, sinceLastHeartbeatMs };
  }
  if (sinceLastHeartbeatMs >= limits.heartbeatStallSeconds * 1000) {
    return { reason: 'heartbeat_stall', elapsedMs, sinceLastHeartbeatMs };
  }
  return null;
}

export interface DeadLetterEscalationInput {
  readonly log: EventLog;
  readonly actorId: string;
  readonly ticketId: string;
  readonly runId?: string | null;
  readonly breach: WatchdogBreach;
}

export interface DeadLetterEscalationOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
}

function evidenceComment(breach: WatchdogBreach): string {
  return [
    `auto-blocked with evidence: watchdog terminated the session tree (${breach.reason}, FR-H2).`,
    `elapsed=${breach.elapsedMs}ms sinceLastHeartbeat=${breach.sinceLastHeartbeatMs}ms`,
  ].join('\n');
}

/**
 * Mints the `session.dead_letter` event, then auto-blocks the ticket:
 * evidence comment + `releaseTicket` back to `ready`. Idempotent to call
 * more than once is NOT guaranteed — callers must fire this at most once
 * per breach (both `commentTicket` and `releaseTicket` require the ticket
 * still be owned; a second call would throw on the transition guard).
 */
export function deadLetterAndBlock(
  input: DeadLetterEscalationInput,
  opts: DeadLetterEscalationOptions = {},
): void {
  appendEvent(
    input.log,
    {
      eventType: 'session.dead_letter',
      actorId: input.actorId,
      ticketId: input.ticketId,
      runId: input.runId ?? null,
      payload: {
        reason: input.breach.reason,
        elapsedMs: input.breach.elapsedMs,
        sinceLastHeartbeatMs: input.breach.sinceLastHeartbeatMs,
      },
    },
    opts,
  );
  commentTicket(
    input.log,
    {
      ticketId: input.ticketId,
      actorId: input.actorId,
      body: evidenceComment(input.breach),
    },
    opts,
  );
  releaseTicket(input.log, { ticketId: input.ticketId, actorId: input.actorId }, opts);
}
