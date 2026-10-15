import type { ServerEnvelope } from '../lib/ws-client.js';
import { humanMessageFromWire } from './human-message.js';
import { cardFromWireEvent, ticketOfItem } from './types.js';

/**
 * Which tickets the composer can reply on, and which it picks by default.
 *
 * The options are the tickets the chat itself names — most recent first —
 * because a reply belongs next to the work it answers. The default is the
 * ticket of the most recent AGENT card (the thing a person is most likely
 * answering); with no agent card naming a ticket, the most recent reply's.
 */
export interface ReplyTargets {
  tickets: string[];
  defaultTicket: string | null;
}

export function replyTargets(events: readonly ServerEnvelope[]): ReplyTargets {
  const seen: string[] = [];
  let lastCardTicket: string | null = null;
  for (const event of events) {
    const card = cardFromWireEvent(event.type, event.data);
    const item = card ?? humanMessageFromWire(event.type, event.data);
    if (!item) continue;
    const ticket = ticketOfItem(item);
    if (ticket === null) continue;
    if (card) lastCardTicket = ticket;
    const at = seen.indexOf(ticket);
    if (at !== -1) seen.splice(at, 1);
    seen.push(ticket);
  }
  const tickets = seen.reverse();
  return { tickets, defaultTicket: lastCardTicket ?? tickets[0] ?? null };
}
