import { appendEvent, type EventLog } from '@dokima/events';
import { getTicket } from './query.js';
import type { TicketCreatedPayload } from './reducer.js';
import type { CreateTicketInput, Ticket } from './types.js';

export interface TicketVerbOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
}

/**
 * Establishes a ticket's contract fields (DATABASE.md §3: "contract fields
 * arrive in the `ticket.created` payload"). Not a lifecycle verb — the six
 * verbs only fold subsequent state, so this is the one place a ticket comes
 * into existence.
 */
export function createTicket(
  log: EventLog,
  actorId: string,
  input: CreateTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    if (getTicket(log, input.id)) {
      throw new Error(`ticket ${input.id} already exists`);
    }
    const payload: TicketCreatedPayload = {
      type: input.type,
      title: input.title,
      lane: input.lane,
      interface: input.interface ?? null,
      // Omitted rather than written as undefined when absent: this payload is
      // hashed into an append-only event (C-6), so a key that means nothing
      // should not be in it.
      ...(input.role === undefined ? {} : { role: input.role }),
      writeScope: input.writeScope,
      dependsOn: input.dependsOn ?? [],
      acceptance: input.acceptance ?? [],
      verify: input.verify ?? null,
    };
    appendEvent(
      log,
      { eventType: 'ticket.created', actorId, ticketId: input.id, payload },
      opts,
    );
    const ticket = getTicket(log, input.id);
    if (!ticket) {
      throw new Error(`ticket.created did not fold into a ticket for ${input.id}`);
    }
    return ticket;
  })();
}
