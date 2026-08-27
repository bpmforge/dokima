/**
 * brief.ts — the founder can tell a stuck maker something (W21-59).
 *
 * PLAN-vault-002a has now had five runs. Run 41 accumulated real work; run 42
 * added nothing and the model oscillated between two wrong import forms —
 * `./argon2id` (ERR_MODULE_NOT_FOUND) and `./argon2id.js` (also
 * ERR_MODULE_NOT_FOUND, because nothing compiles). The correct form is
 * `./argon2id.ts`, which PLAN-vault-001b's tsconfig deliberately enabled with
 * `allowImportingTsExtensions`.
 *
 * So the founder could see exactly what the maker needed to know, and had no
 * way to say it. W21-27 (widen-scope) and W21-51 (depends-on) let a person
 * change a ticket's SHAPE; nothing let them add KNOWLEDGE. Comments do not
 * reach the maker — `buildHandoff` carries `title`, `writeScope`, the
 * acceptance criteria, the verify command, and `context`, and nothing else.
 *
 * The channel already existed and was simply unwritable. `context` is
 * `ticket.interface ?? ticket.title`, so the `interface` field IS the founder's
 * line to the maker — set once at decomposition and never again. This adds the
 * verb, and nothing else: no new plumbing, no second path into the prompt.
 *
 * IT IS A BRIEF, NOT AN INSTRUCTION TO OBEY. The maker still has to satisfy
 * the same gates against the same acceptance criteria (C-2) — a brief cannot
 * make anything pass, only tell a model something true about the project it
 * would otherwise have to discover. That is why it is safe for a person to
 * write, and why it is not a way around the trust boundary.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { TicketVerbOptions } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import type { Ticket } from './types.js';

export interface SetTicketBriefInput {
  readonly ticketId: string;
  readonly actorId: string;
  /** The context the maker is handed. Replaces any previous brief. */
  readonly brief: string;
}

/**
 * Sets a ticket's `interface` — the context block every handoff for it will
 * carry. Refuses an empty brief: clearing it silently would leave the maker
 * with the title alone and no sign that anything was meant to be there.
 */
export function setTicketBrief(
  log: EventLog,
  input: SetTicketBriefInput,
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
    const brief = input.brief.trim();
    if (brief.length === 0) {
      throw new TicketError(
        'MANIFEST_INVALID',
        input.ticketId,
        `brief refused: an empty brief would leave the maker with the title alone ` +
          `and no sign anything was meant to be there`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.brief_set',
        actorId: input.actorId,
        ticketId: ticket.id,
        runId: opts.runId ?? null,
        payload: { from: ticket.interface, to: brief },
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
