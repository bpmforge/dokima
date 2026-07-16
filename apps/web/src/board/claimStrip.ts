import type { BoardTicket } from './types.js';

/**
 * Claim-now strip (UX_SPEC §4): the smallest ready ticket per lane —
 * "smallest" is the board projection's `sortKey` order (DATABASE.md §3,
 * same ordering the columns render with), one entry per lane.
 */
export function claimNowEntries(tickets: readonly BoardTicket[]): BoardTicket[] {
  const byLane = new Map<string, BoardTicket>();
  for (const ticket of tickets) {
    if (!ticket.claimable) continue;
    const current = byLane.get(ticket.lane);
    if (!current || ticket.sortKey.localeCompare(current.sortKey) < 0) {
      byLane.set(ticket.lane, ticket);
    }
  }
  return Array.from(byLane.values()).sort((a, b) => a.lane.localeCompare(b.lane));
}
