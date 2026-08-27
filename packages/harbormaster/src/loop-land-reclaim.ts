import { commentTicket, listTickets, releaseTicket } from '@dokima/tickets';
import { listEvents } from '@dokima/events';
import { findAbandonedTickets, STALE_CLAIM_MS } from './loop-claim.js';
import { orphanedClaimNotice, orphanedClaims } from './loop-land-orphan.js';
import type { LandLoopOptions } from './loop-land.js';

/**
 * Reclaim what an owner that is gone left behind, before choosing the next
 * ticket (W13-12).
 *
 * Two runs in one session of live testing ended with a ticket stuck in
 * `in_progress` — one killed from outside, one crashed by an uncaught provider
 * timeout (W13-13) — and the next run then reported "0 landed, 0 parked" in
 * zero seconds, because nothing was claimable and nothing said why. A closed
 * laptop lid does the same.
 *
 * It goes through `releaseTicket`, never a status write, so the log explains
 * what happened and to whom (Law 4, C-2/C-3).
 *
 * Extracted from `loop-land.ts` verbatim when W13-40 pushed that file over the
 * 400-line cap — a move, not a rewrite.
 */
export function reclaimAbandoned(options: LandLoopOptions): void {
  /**
   * W21-40: first, the claims that need no waiting at all. A claim stamped
   * with a different run's id belongs to a run that has ended (C-6: one writer
   * per project DB), so the thirty-minute window below has nothing to measure.
   */
  for (const orphan of orphanedClaims(options.log, options.runId)) {
    const body = orphanedClaimNotice(orphan, options.runId!);
    commentTicket(options.log, { ticketId: orphan.ticket.id, actorId: options.actorId, body });
    releaseTicket(
      options.log,
      {
        ticketId: orphan.ticket.id,
        actorId: options.actorId,
        steal: { reason: `claimed by run ${orphan.heldByRunId}, which has ended` },
      },
      { runId: options.runId ?? null },
    );
  }
  for (const abandoned of findAbandonedTickets(
    listTickets(options.log),
    listEvents(options.log),
    options.now ? options.now() : new Date().toISOString(),
  )) {
    commentTicket(options.log, {
      ticketId: abandoned.id,
      actorId: options.actorId,
      body:
        `reclaimed: held by ${abandoned.ownerId ?? 'an unknown owner'} with no activity ` +
        `for over ${Math.round(STALE_CLAIM_MS / 60000)} minutes, so the session that ` +
        `claimed it is gone (crash, kill, or a closed lid). Returned to ready; any work ` +
        `it committed is still on its branch.`,
    });
    // W21-33: an abandoned claim belongs to a run that is gone — this is the
    // steal the guard must never block, or a dead run's claim is permanent.
    releaseTicket(
      options.log,
      {
        ticketId: abandoned.id,
        actorId: options.actorId,
        steal: {
          reason:
            `orphaned claim: no activity for over ` +
            `${Math.round(STALE_CLAIM_MS / 60000)} minutes`,
        },
      },
      { runId: options.runId ?? null },
    );
  }
}
