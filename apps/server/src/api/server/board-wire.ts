import {
  effectiveStatus,
  isClaimable,
  isStaleBlocked,
  type Ticket,
} from '@shipwright/tickets';

/**
 * Wire shape for `apps/web/src/board/types.ts` `BoardTicket` (hand-mirrored
 * there per that file's own comment — apps/web may not import
 * `@shipwright/tickets` directly, ARCHITECTURE §4). `wave`/`sort_key` are
 * documented in DATABASE.md §3's `board` table but have no producer in
 * `packages/tickets` yet (no wave/phase concept on a ticket) — honest
 * placeholders rather than invented data (C-1, same precedent as
 * `apps/server/src/api/projects.ts`'s `EMPTY_STATS`): `wave` is always 0,
 * `sortKey` is the ticket's own id (a real, stable, already-unique value).
 */
export interface WireBoardTicket extends Ticket {
  claimable: boolean;
  staleBlocked: boolean;
  wave: number;
  sortKey: string;
}

export function toWireBoardTicket(
  ticket: Ticket,
  byId: ReadonlyMap<string, Ticket>,
): WireBoardTicket {
  return {
    ...ticket,
    status: effectiveStatus(ticket, byId),
    claimable: isClaimable(ticket, byId),
    staleBlocked: isStaleBlocked(ticket, byId),
    wave: 0,
    sortKey: ticket.id,
  };
}
