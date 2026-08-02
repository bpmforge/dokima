/**
 * Lane-exclusive ticket selection (BLUEPRINT §5/§3.4, D-010, FR-H5): "at
 * most one berth per lane" is enforced here, at pick time, rather than by
 * post-hoc conflict detection. `busyLanes` mirrors `@dokima/tickets`'
 * `lanes.ts` `isLaneActive` check (private there — FR-T3's own
 * `claimed`/`in_progress`/`in_review` "still occupies its write_scope
 * until accepted" definition) so a ticket landed to `in_review` keeps its
 * lane reserved for the SAME reason `lanes.ts` gives: the diff is parked
 * for review, not yet safe to build on top of.
 *
 * `pickNextBerthTicket` is deliberately a pure, synchronous function over
 * an already-loaded ticket snapshot — callers (`berths.ts`) must call it
 * and `claimTicket` back-to-back with no `await` between them. Node is
 * single-threaded and `EventLog` reads/writes are synchronous
 * (better-sqlite3), so that back-to-back pair is already atomic with
 * respect to every other concurrently-running berth in the same process:
 * no other berth's code can run between "read ticket state" and "claim",
 * which is exactly BLUEPRINT §5's "the claim step re-checks lane
 * occupancy atomically — single-writer event append is the serialization
 * point, no distributed locking needed."
 */

import { isClaimable, type Ticket, type TicketStatus } from '@dokima/tickets';

/** Matches `@dokima/tickets`' `lanes.ts` `ACTIVE_LANE_STATUSES` (private there, FR-T3): a lane holding any ticket in one of these statuses cannot take a second active ticket. */
const ACTIVE_LANE_STATUSES: ReadonlySet<TicketStatus> = new Set([
  'claimed',
  'in_progress',
  'in_review',
]);

/** Every lane with at least one actively-owned or in-review ticket, across all berths. */
export function busyLanes(tickets: readonly Ticket[]): ReadonlySet<string> {
  const lanes = new Set<string>();
  for (const ticket of tickets) {
    if (ACTIVE_LANE_STATUSES.has(ticket.status)) lanes.add(ticket.lane);
  }
  return lanes;
}

/**
 * Lowest-id claimable ticket whose lane is not already busy, excluding
 * `skip` (this berth's own already-processed tickets this run). Mirrors
 * `loop-claim.ts`/`loop-land.ts`'s own `pickNextTicket` tie-break
 * (lowest id first, deterministic) with the added lane filter that makes
 * N-berth scheduling collision-free.
 */
export function pickNextBerthTicket(
  tickets: readonly Ticket[],
  skip: ReadonlySet<string>,
): Ticket | undefined {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const busy = busyLanes(tickets);
  return tickets
    .filter(
      (ticket) =>
        !skip.has(ticket.id) && !busy.has(ticket.lane) && isClaimable(ticket, byId),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}
