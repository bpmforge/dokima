/**
 * loop-land-board-causes.ts — defects that belong to the BOARD, recorded once
 * (W23-30).
 *
 * Live (Vault, 2026-09-18): two tickets, two full ladders, four agent
 * sessions — one of them 2008 s to the watchdog ceiling — to rediscover one
 * fact: package.json's `test` script ran nothing, and package.json was in no
 * ticket's write_scope. The loop did everything right per ticket and still
 * spent the run, because the finding was recorded on the wrong object. A park
 * comment is a ticket's account of itself; this is the run's account of the
 * board.
 *
 * A chapter of loop-land.ts (at the 400-line cap), and a seam: that file
 * claims and lands tickets, this one remembers what the board owes.
 */
import { appendEvent } from '@dokima/events';
import { commentTicket, releaseTicket, type Ticket } from '@dokima/tickets';
import type { LandLoopOptions, LandLoopTicketOutcome } from './loop-land.js';

/**
 * Recorded once — as a `board.verify_unrunnable` event and on the run's
 * finish line — and used to leave sibling tickets unclaimed rather than spend
 * a ladder each. `verify` is the ticket field siblings are matched on: `null`
 * means "derived from the worktree", which is the same command for every
 * ticket on the board.
 */
export interface BoardCause {
  readonly kind: 'verify_unrunnable';
  readonly detail: string;
  readonly verify: string | null;
  readonly parkedTicketId: string;
  readonly skippedTicketIds: readonly string[];
}

/** True when `ticket` verifies with a command the board already knows cannot run; records the skip. */
export function siblingOfKnownCause(
  causes: readonly BoardCause[],
  ticket: Ticket,
): boolean {
  const known = causes.find((c) => c.verify === (ticket.verify ?? null));
  if (!known) return false;
  (known.skippedTicketIds as string[]).push(ticket.id);
  return true;
}

/**
 * After a ticket parks for an unrunnable verify: remember the cause for the
 * rest of the run and append it to the log as the board's own event — durable,
 * and not a comment on the ticket that happened to find it. The notifications
 * projection can carry it to the morning queue; the finish line carries it to
 * whoever ran this.
 */
export function recordBoardCause(
  options: LandLoopOptions,
  ticket: Ticket,
  outcome: LandLoopTicketOutcome,
  causes: BoardCause[],
): void {
  if (outcome.parkedReason !== 'verify_unrunnable' || !outcome.parkedDetail) return;
  const cause: BoardCause = {
    kind: 'verify_unrunnable',
    detail: outcome.parkedDetail,
    verify: ticket.verify ?? null,
    parkedTicketId: ticket.id,
    skippedTicketIds: [],
  };
  causes.push(cause);
  appendEvent(
    options.log,
    {
      eventType: 'board.verify_unrunnable',
      actorId: options.actorId,
      ticketId: ticket.id,
      ...(options.runId ? { runId: options.runId } : {}),
      payload: { detail: cause.detail, verify: cause.verify },
    },
    options.now ? { now: options.now } : {},
  );
}

/**
 * W21-37: a ticket whose base cannot be built is comment-and-released, not
 * attempted. Running it anyway is what produced the live failure — a session
 * spending its whole budget being asked to redo a dependency's work. The
 * comment is the founder's evidence; `isStuckTicket` (W21-26) will surface it
 * once it repeats.
 */
export function refuseTicketBase(
  options: LandLoopOptions,
  ticket: Ticket,
  reason: string,
): LandLoopTicketOutcome {
  const opts = { runId: options.runId ?? null };
  commentTicket(
    options.log,
    { ticketId: ticket.id, actorId: options.actorId, body: reason },
    opts,
  );
  releaseTicket(options.log, { ticketId: ticket.id, actorId: options.actorId }, opts);
  return {
    ticketId: ticket.id,
    mode: 'ladder',
    attempts: [],
    landed: false,
    parked: true,
    // W21-72: `reason` is right here and used to be dropped on the floor.
    parkedReason: 'cannot_start',
    parkedDetail: reason,
    finalStatus: 'ready',
  };
}
