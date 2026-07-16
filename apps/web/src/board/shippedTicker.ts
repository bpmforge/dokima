import type { BoardTicket } from './types.js';

export interface ShippedCommit {
  sha: string;
  ticketId: string;
  ticketTitle: string;
  closedAt: string;
}

function localMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Shipped-today ticker (UX_SPEC §4): commits landed since local midnight,
 * linked to their tickets. Derived client-side from the same board rows
 * the columns render — closed tickets carry their manifest's commit list
 * (DATABASE.md §3 `manifest.commits`), no separate endpoint needed.
 */
export function shippedSinceMidnight(
  tickets: readonly BoardTicket[],
  now: Date,
): ShippedCommit[] {
  const midnight = localMidnight(now);
  const shipped: ShippedCommit[] = [];
  for (const ticket of tickets) {
    if (ticket.status !== 'done' || !ticket.closedAt || !ticket.manifest) continue;
    const closedAt = new Date(ticket.closedAt);
    if (closedAt < midnight) continue;
    for (const sha of ticket.manifest.commits) {
      shipped.push({
        sha,
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        closedAt: ticket.closedAt,
      });
    }
  }
  return shipped.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}
