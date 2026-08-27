import { appendEvent, type EventLog } from '@dokima/events';
import { validateLaneWriteScopes } from './lanes.js';
import { getTicket, loadTickets } from './query.js';
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
    /**
     * W21-49: the lane invariant, enforced where tickets come into existence.
     *
     * It had only ever been checked by `widenTicketScope` (W21-27), so the
     * pipeline was free to emit boards it forbids — and did: a single real
     * onboard run produced SEVEN cross-lane overlaps, because every onboard
     * ticket carries the whole-repo `['**']` scope and they were split across
     * two lanes. CLAUDE.md law 1 calls that a schema bug and BLUEPRINT says
     * the invariant is what makes N berths provably collision-free, so those
     * boards could not honestly run at berths > 1.
     *
     * Checking here rather than at the end of decomposition is what makes it
     * unavoidable: there is one place a ticket is created, and every caller —
     * pipeline, onboard, founder (W21-48) — goes through it.
     *
     * Every prefix of a valid board is valid, since a subset of
     * non-overlapping lanes cannot overlap, so this never refuses a
     * decomposition that would have been accepted whole.
     */
    if (ticket) validateLaneWriteScopes([...loadTickets(log).values()]);
    if (!ticket) {
      throw new Error(`ticket.created did not fold into a ticket for ${input.id}`);
    }
    return ticket;
  })();
}

/**
 * W21-48: `createTicket`, plus the lane invariant — the founder path.
 *
 * Cross-lane write-scope overlap is a schema bug (CLAUDE.md law 1) and the
 * reason N berths are provably collision-free, so a ticket a PERSON types
 * needs the same check `widenTicketScope` applies. That check is deliberately
 * NOT inside `createTicket` itself: turning it on there failed five existing
 * tests, and every one of them was a real pre-existing violation rather than a
 * test artefact — including the onboard pipeline's own decomposition, which
 * emits seven cross-lane overlaps in a single run. Fixing that is a separate
 * ticket with its own evidence; quietly bundling it here would have hidden it.
 *
 * So this is the narrow, honest version: the founder cannot introduce an
 * overlap, and the pre-existing ones stay visible as their own defect.
 */
export function createTicketValidatingLanes(
  log: EventLog,
  actorId: string,
  input: CreateTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const ticket = createTicket(log, actorId, input, opts);
    validateLaneWriteScopes([...loadTickets(log).values()]);
    return ticket;
  })();
}
