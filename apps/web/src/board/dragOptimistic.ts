import type { BoardTicket, Ticket, TicketStatus } from './types.js';

/**
 * Per-ticket optimistic apply/confirm/rollback (NFR-2 baseline, same triad
 * as `lib/optimistic.ts` but keyed by ticket since a board mutates one row
 * of many). A drag moves the card immediately; the server's answer either
 * confirms (merge its canonical fields) or refuses (roll back to the
 * pre-drag snapshot and let the caller show the explain-this-refusal
 * popover, FR-T4).
 */
export type BoardTicketMap = ReadonlyMap<string, BoardTicket>;

export interface OptimisticMove {
  tickets: BoardTicketMap;
  snapshot: BoardTicket;
}

export function beginOptimisticMove(
  tickets: BoardTicketMap,
  ticketId: string,
  toStatus: TicketStatus,
): OptimisticMove | null {
  const snapshot = tickets.get(ticketId);
  if (!snapshot) return null;
  const next = new Map(tickets);
  next.set(ticketId, { ...snapshot, status: toStatus });
  return { tickets: next, snapshot };
}

export function confirmOptimisticMove(
  tickets: BoardTicketMap,
  ticketId: string,
  serverTicket: Ticket,
): BoardTicketMap {
  const current = tickets.get(ticketId);
  const next = new Map(tickets);
  next.set(ticketId, { ...(current ?? (serverTicket as BoardTicket)), ...serverTicket });
  return next;
}

export function rollbackOptimisticMove(
  tickets: BoardTicketMap,
  ticketId: string,
  snapshot: BoardTicket,
): BoardTicketMap {
  const next = new Map(tickets);
  next.set(ticketId, snapshot);
  return next;
}
