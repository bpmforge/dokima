import type { Ticket, TicketStatus } from './types.js';

function byIdMap(tickets: readonly Ticket[]): ReadonlyMap<string, Ticket> {
  return new Map(tickets.map((t) => [t.id, t]));
}

/** A missing dependency (dangling id) is treated as not-done, never satisfied by absence. */
export function depsDone(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): boolean {
  return ticket.dependsOn.every((depId) => byId.get(depId)?.status === 'done');
}

/**
 * Derived display status. The six lifecycle verbs (transitions.ts) never
 * produce `blocked` — it is a pure overlay over a `ready` ticket whose
 * dependencies are not all `done`, recomputed here from live state on every
 * call. Because there is no separate "enter/exit blocked" event, `blocked`
 * <-> `ready` is auto-resolving by construction: the only way in or out is
 * this recompute (FR-T3).
 */
export function effectiveStatus(
  ticket: Ticket,
  byId: ReadonlyMap<string, Ticket>,
): TicketStatus {
  if (ticket.status === 'ready' && !depsDone(ticket, byId)) return 'blocked';
  return ticket.status;
}

/** claimable = ready AND unowned AND deps done (FR-T3), recomputed fresh on every event. */
export function isClaimable(ticket: Ticket, byId: ReadonlyMap<string, Ticket>): boolean {
  return ticket.status === 'ready' && ticket.ownerId === null && depsDone(ticket, byId);
}

/**
 * Badge for a ticket whose *stored* status is literally `blocked` (set by a
 * future reflow-event writer or an external caller — the projection's
 * `TicketStatus` type permits it) while its blockers have since completed:
 * a staleness signal meaning reflow should have already cleared it.
 * Exported for the board UI (DATABASE.md `board.stale_blocked`).
 */
export function isStaleBlocked(
  ticket: Ticket,
  byId: ReadonlyMap<string, Ticket>,
): boolean {
  return ticket.status === 'blocked' && depsDone(ticket, byId);
}

export interface BoardEntry {
  ticketId: string;
  status: TicketStatus;
  claimable: boolean;
  staleBlocked: boolean;
}

/** board projection (DATABASE.md §3): claimable set + UI flags, recomputed on every event. */
export function computeBoard(tickets: readonly Ticket[]): BoardEntry[] {
  const byId = byIdMap(tickets);
  return tickets.map((ticket) => ({
    ticketId: ticket.id,
    status: effectiveStatus(ticket, byId),
    claimable: isClaimable(ticket, byId),
    staleBlocked: isStaleBlocked(ticket, byId),
  }));
}
