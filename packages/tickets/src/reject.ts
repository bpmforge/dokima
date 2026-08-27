/**
 * reject.ts — the reviewer may send work back (W21-42).
 *
 * The gap this closes is the one shape a review gate must never have.
 * `acceptTicket` refuses when the actor IS the owner (maker != verifier, C-4).
 * `releaseTicket` from `in_review` requires the actor to BE the owner. So the
 * verifier identity was permitted to approve and forbidden to send work back,
 * and the only way to reject was to act as the thing being reviewed.
 *
 * Hit twice live and from the founder's side both times:
 *
 *   $ dokima release PLAN-vault-002 --actor local-operator
 *   refused [NOT_OWNER]: actor local-operator does not own ticket
 *   PLAN-vault-002 (owner: operator)
 *
 * The first was a placeholder password hash that had passed every gate; the
 * second was a ticket that landed having changed one line and skipped the file
 * it was created for. In both cases the review was correct and unactionable.
 *
 * A REASON IS REQUIRED, and that asymmetry with `accept` is the point. An
 * accept needs no words because the close receipt is the evidence — signed,
 * verifiable, and already in the ledger. A rejection has no receipt behind it:
 * it is a judgement, and a judgement with no stated grounds is indistinguish-
 * able from a whim to whoever picks the ticket up next.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { TicketVerbOptions } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import { isValidTransition, TRANSITIONS } from './transitions.js';
import type { Ticket } from './types.js';

export interface RejectTicketInput {
  readonly ticketId: string;
  readonly actorId: string;
  /** Why the work was sent back. Reaches the next attempt's handoff. */
  readonly reason: string;
}

/**
 * Sends reviewed work back to `ready`. Refuses the ticket's own owner, by the
 * same rule `accept` uses and for the same reason: a maker must not be able to
 * dispose of its own work in either direction.
 */
export function rejectTicket(
  log: EventLog,
  input: RejectTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = tickets.get(input.ticketId);
    if (!ticket) {
      throw new TicketError(
        'TICKET_NOT_FOUND',
        input.ticketId,
        `ticket ${input.ticketId} does not exist`,
      );
    }
    if (!isValidTransition('reject', ticket.status)) {
      throw new TicketError(
        'INVALID_TRANSITION',
        ticket.id,
        `reject refused: ticket ${ticket.id} is ${ticket.status}, expected one of ` +
          `[${TRANSITIONS.reject.from.join(', ')}]`,
      );
    }
    if (ticket.ownerId === input.actorId) {
      throw new TicketError(
        'SELF_ACCEPT',
        ticket.id,
        `reject refused: reviewer ${input.actorId} is also the owner of ${ticket.id} ` +
          `(maker != verifier) — a maker must not dispose of its own work in ` +
          `either direction`,
      );
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new TicketError(
        'MANIFEST_INVALID',
        ticket.id,
        `reject refused: a reason is required. An accept needs no words because ` +
          `the close receipt is the evidence; a rejection has no receipt behind ` +
          `it, so the reason is the whole artifact`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.rejected',
        actorId: input.actorId,
        ticketId: ticket.id,
        runId: opts.runId ?? null,
        payload: { reason, rejectedOwner: ticket.ownerId },
      },
      opts,
    );
    const updated = loadTickets(log).get(ticket.id);
    if (!updated) {
      throw new TicketError('TICKET_NOT_FOUND', ticket.id, `ticket ${ticket.id} vanished`);
    }
    return updated;
  })();
}

/**
 * The most recent rejection reason for a ticket, or null. Read back at claim
 * time so the next attempt meets the judgement that sent its predecessor back
 * — the same posture W21-45 established for park evidence.
 */
export function latestRejectionReason(
  events: readonly { eventType: string; ticketId: string | null; payload: unknown }[],
  ticketId: string,
): string | null {
  let reason: string | null = null;
  for (const event of events) {
    if (event.ticketId !== ticketId) continue;
    if (event.eventType === 'ticket.closed' || event.eventType === 'ticket.accepted') {
      reason = null;
      continue;
    }
    if (event.eventType !== 'ticket.rejected') continue;
    const payload = event.payload as { reason?: unknown };
    if (typeof payload.reason === 'string') reason = payload.reason;
  }
  return reason;
}
