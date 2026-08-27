/**
 * acceptance.ts — the founder can amend a criterion that proves nothing
 * (W21-71).
 *
 * W21-50 probes each passing acceptance criterion against the ticket's base in
 * a throwaway worktree, and refuses a close when the criterion returns the
 * same answer either way. It is one of the sharpest gates in the product, and
 * on the live project it caught a bad ticket the founder filed:
 *
 *   PLAN-vault-002b: "acceptance criterion AC-1 proves nothing:
 *   `node --test src/crypto/argon2id.spec.ts` passes against this ticket's
 *   BASE too, so it returns the same answer whether or not the work was done.
 *   Give the ticket a criterion that FAILS before the work and passes after."
 *
 * Correct, precisely worded — and unactionable. `dokima --help` listed
 * eighteen verbs and not one of them could change a criterion. Every other
 * wrong-ticket axis already had its repair: `widen-scope` for a scope that
 * cannot satisfy its own acceptance (W21-27), `depends-on` for a ticket
 * pointed at the wrong work (W21-51), `brief` for a maker missing knowledge
 * (W21-59), `reject` for work sent back (W21-42). The one change the product
 * explicitly ASKS a person to make was the one it gave them no way to make,
 * so the ticket could never close and could never stop being offered.
 *
 * That is the recurring shape of W21-45/46: knowledge the product holds and
 * cannot act on. Here it is worse than a wasted attempt, because the gate is
 * right and the founder is stuck agreeing with it.
 *
 * IT CANNOT MAKE ANYTHING PASS. The new criterion faces exactly the same
 * gates as the old one, W21-50 included — an amended criterion that still
 * proves nothing is refused again, in the same words. This verb changes what
 * is being asked for, never whether the answer was good enough (C-2).
 *
 * REFUSED ON A DONE TICKET, deliberately. A closed ticket's receipt records
 * the criteria its work was judged against; letting those move afterwards
 * would make an accepted receipt describe a test that was never run against
 * it, which is the one thing the receipt exists to prevent.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { TicketVerbOptions } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import type { AcceptanceCriterion, Ticket } from './types.js';

export interface RetargetAcceptanceInput {
  readonly ticketId: string;
  readonly actorId: string;
  /** The COMPLETE new criteria list — this replaces, it does not append. */
  readonly criteria: readonly string[];
  /** Why, for the ledger and for the next person reading the board. */
  readonly reason: string;
}

/**
 * Numbers criteria the way `createTicket` does, so an amended ticket is
 * indistinguishable in shape from one filed correctly the first time.
 */
export function numberCriteria(criteria: readonly string[]): AcceptanceCriterion[] {
  return criteria.map((text, index) => ({
    id: `AC-${index + 1}`,
    text,
    done: false,
  }));
}

/**
 * Replaces a ticket's acceptance criteria. Refuses a done ticket (its receipt
 * names the criteria it was judged against), an empty list (a ticket with no
 * criterion cannot be closed at all, so this would strand it more quietly
 * than the bad criterion did), and a missing reason (the whole point is that
 * the next person can see why the ask changed).
 */
export function retargetTicketAcceptance(
  log: EventLog,
  input: RetargetAcceptanceInput,
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
    if (ticket.status === 'done') {
      throw new TicketError(
        'INVALID_TRANSITION',
        input.ticketId,
        `acceptance retarget refused: ${input.ticketId} is done, and its receipt records ` +
          `the criteria its work was judged against — moving them now would make an ` +
          `accepted receipt describe a check that never ran against it`,
      );
    }
    const criteria = input.criteria.map((text) => text.trim()).filter((text) => text.length > 0);
    if (criteria.length === 0) {
      throw new TicketError(
        'MANIFEST_INVALID',
        input.ticketId,
        `acceptance retarget refused: a ticket with no criterion can never be closed, ` +
          `which strands it more quietly than the criterion you are replacing`,
      );
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new TicketError(
        'MANIFEST_INVALID',
        input.ticketId,
        `acceptance retarget refused: changing what a ticket asks for needs a reason ` +
          `on the record, so the next person can see why the ask moved`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.acceptance_retargeted',
        actorId: input.actorId,
        ticketId: ticket.id,
        runId: opts.runId ?? null,
        payload: {
          from: ticket.acceptance.map((criterion) => criterion.text),
          to: criteria,
          reason,
        },
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
