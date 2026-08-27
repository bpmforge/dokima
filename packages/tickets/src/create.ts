import { appendEvent, type EventLog } from '@dokima/events';
import { getTicket } from './query.js';
import type { TicketCreatedPayload } from './reducer.js';
import type { CreateTicketInput, Ticket } from './types.js';

export interface TicketVerbOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
  /**
   * W21-32: the run this verb belongs to, stamped onto the event.
   *
   * The events table has carried a `run_id` column all along, and every other
   * subsystem fills it — `mcp.tool_call.completed`, `spend.recorded`,
   * `session.turns_observed`, `memory.consolidated`. The six lifecycle verbs
   * never did, so every `ticket.claimed` / `ticket.released` ever written is
   * `run_id = NULL`, and the ledger cannot answer "which run did this?".
   *
   * That cost a live diagnosis: working out which run released a ticket out
   * from under another one meant correlating the release's TIMESTAMP against
   * neighbouring events that did carry a run id. The answer was in the ledger
   * only by inference.
   *
   * Optional, and absent means absent — a person acting through the API has
   * no run, and writing a fake one would be worse than a null.
   */
  runId?: string | null;
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
      {
        eventType: 'ticket.created',
        actorId,
        ticketId: input.id,
        runId: opts.runId ?? null,
        payload,
      },
      opts,
    );
    const ticket = getTicket(log, input.id);
    if (!ticket) {
      throw new Error(`ticket.created did not fold into a ticket for ${input.id}`);
    }
    return ticket;
  })();
}
