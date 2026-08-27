/**
 * loop-land-orphan.ts — a claim held by a run that has ended (W21-40).
 *
 * This shape has now cost three runs and it is always the same. A run dies
 * holding a claim; the ticket stays `in_progress`; the NEXT run finds nothing
 * claimable and reports
 *
 *   0 landed, 0 parked (stop: idle)
 *
 * while the board says the ticket is in progress. Two surfaces of one product
 * disagreeing, with the reassuring one printed by default and the accurate one
 * needing to be asked for.
 *
 * `reclaimAbandoned` already exists for this and its reasoning is sound for
 * the case it was written for: the event log is the heartbeat, and a LIVE
 * session that has gone quiet must never be reaped early — hence
 * `STALE_CLAIM_MS` at thirty minutes, twice the longest legitimate silence.
 *
 * But a run whose PROCESS IS GONE is not a quiet session, and the product can
 * tell the difference without waiting. Since W21-32 every `ticket.claimed`
 * carries the run that made it, and C-6 gives one writer per project DB — so a
 * claim stamped with a DIFFERENT run id than the one now running belongs, by
 * construction, to a run that is no longer running. There is nothing to wait
 * for.
 *
 * The thirty-minute window keeps its meaning untouched for the case it was
 * built for: a claim from THIS run, or one with no run id at all (a person at
 * the API), is left alone by this and handled by `reclaimAbandoned` as before.
 */
import { listTickets, type Ticket } from '@dokima/tickets';
import type { EventLog } from '@dokima/events';

export interface OrphanedClaim {
  readonly ticket: Ticket;
  /** The run that made the claim and is no longer running. */
  readonly heldByRunId: string;
}

/**
 * Tickets claimed by a run other than `currentRunId`. Empty when the current
 * run has no id — without one there is nothing to compare against, and
 * guessing would reap live work.
 */
export function orphanedClaims(log: EventLog, currentRunId: string | undefined): OrphanedClaim[] {
  if (!currentRunId) return [];
  const orphans: OrphanedClaim[] = [];
  for (const ticket of listTickets(log)) {
    if (ticket.status !== 'claimed' && ticket.status !== 'in_progress') continue;
    const heldByRunId = ticket.claimRunId;
    if (!heldByRunId || heldByRunId === currentRunId) continue;
    orphans.push({ ticket, heldByRunId });
  }
  return orphans;
}

/** The comment left on a reclaimed ticket — says which run, and why waiting was pointless. */
export function orphanedClaimNotice(orphan: OrphanedClaim, currentRunId: string): string {
  return (
    `reclaimed immediately: ${orphan.ticket.id} was claimed by run ` +
    `${orphan.heldByRunId}, which is not the run now working (${currentRunId}). ` +
    `One run holds the writer at a time (C-6), so a claim stamped with another ` +
    `run's id belongs to a run that has ended — there is nothing to wait for. ` +
    `Any work it committed is still on its branch.`
  );
}

/**
 * The line a run prints when it found nothing to claim BECAUSE tickets are
 * held, rather than because the board is empty. `stop: idle` reads identically
 * for both, and that is what made this class invisible three times over.
 */
export function heldTicketsNotice(held: readonly string[]): string | null {
  if (held.length === 0) return null;
  const plural = held.length === 1 ? 'ticket is' : 'tickets are';
  return (
    `${held.length} ${plural} held by a run that is no longer running and could ` +
    `not be reclaimed: ${held.join(', ')}. The board shows them in progress; ` +
    `nothing is working them. This run had nothing else to do, which is not the ` +
    `same as there being nothing to do.`
  );
}
