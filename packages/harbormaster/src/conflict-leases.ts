/**
 * Active write-scope leases (BLUEPRINT §7.3: "write-scopes are exclusive
 * leases registered with the Ticket Engine... The UI shows leased paths
 * (subtle lock badge in any file tree)"). A ticket leases its write_scope
 * for as long as it is actively owned — `claimed` or `in_progress`, the
 * exact `isActiveOwnership` boundary `@shipwright/tickets`' `verbs.ts`
 * already draws for WIP=1: `in_review` does not lease (close is what frees
 * the worker, so the scope is no longer being actively written).
 */

import type { Ticket } from '@shipwright/tickets';
import type { LeaseRecord, LeasedPathBadge } from './conflict-types.js';

function isActivelyLeased(ticket: Ticket): boolean {
  return (
    ticket.ownerId !== null &&
    (ticket.status === 'claimed' || ticket.status === 'in_progress')
  );
}

/** Every ticket's active lease, derived fresh from live ticket state — never a separate stored table. */
export function activeLeases(tickets: readonly Ticket[]): LeaseRecord[] {
  return tickets.filter(isActivelyLeased).map((ticket) => ({
    ticketId: ticket.id,
    ownerId: ticket.ownerId as string,
    writeScope: ticket.writeScope,
  }));
}

/** One lock-badge entry per (ticket, glob) — the UI's file-tree lock overlay (UX_SPEC §4). */
export function leaseBadges(tickets: readonly Ticket[]): LeasedPathBadge[] {
  return activeLeases(tickets).flatMap((lease) =>
    lease.writeScope.map((glob) => ({
      glob,
      ticketId: lease.ticketId,
      ownerId: lease.ownerId,
    })),
  );
}
