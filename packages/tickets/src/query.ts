import { listEvents, rebuildProjection, type EventLog } from '@dokima/events';
import { ticketsProjection } from './reducer.js';
import type { Ticket } from './types.js';

/** Rebuild-from-zero (DATABASE.md §3): tickets are a disposable projection. */
export function loadTickets(log: EventLog): ReadonlyMap<string, Ticket> {
  return rebuildProjection(listEvents(log), ticketsProjection);
}

export function getTicket(log: EventLog, ticketId: string): Ticket | undefined {
  return loadTickets(log).get(ticketId);
}

export function listTickets(log: EventLog): Ticket[] {
  return Array.from(loadTickets(log).values());
}
