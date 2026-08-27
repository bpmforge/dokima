/**
 * retarget.ts — the founder can point a ticket at a different dependency
 * (W21-51).
 *
 * W21-48 let a founder ADD a ticket the board was missing. It turned out that
 * is only half a board correction, and the live project proved it inside one
 * run: I added `PLAN-vault-001b` to fix a toolchain contradiction, it landed,
 * I accepted it — and `PLAN-vault-002` still failed, because its `dependsOn`
 * still named only `PLAN-vault-001`. Its base was composed from the accepted
 * dependency it knew about, so the fix never reached its worktree, whose
 * tsconfig still read `"module": "commonjs"`.
 *
 * A ticket nothing depends on is not on the DAG in any useful sense. Adding
 * one without being able to point existing work at it produces an orphan and
 * a founder who cannot tell why nothing changed.
 *
 * `ticket-edit-routes.ts` already validates this edit completely — unknown
 * ticket ids and dependency cycles are refused with the standard
 * explain-refusal shape — and then returns 501, because there was no event to
 * append it as and inventing one was out of that ticket's write_scope. Its
 * own docstring names the follow-up: "a future ticket adding a
 * ticket.updated/ticket.split/ticket.merged event type + reducer case to
 * packages/tickets turns the 501 branch below into a real write". This is
 * that ticket, narrowed to the one edit a live project actually needed.
 *
 * APPEND-ONLY IS NOT AN OBSTACLE (C-6): retargeting is an append like every
 * other verb, and the previous dependencies stay readable in the log. Nothing
 * is rewritten.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { TicketVerbOptions } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import type { Ticket } from './types.js';

export interface RetargetDependenciesInput {
  readonly ticketId: string;
  readonly actorId: string;
  /** The COMPLETE new dependency list — this replaces, it does not append. */
  readonly dependsOn: readonly string[];
  /** Why, for the ledger and for the next person reading the board. */
  readonly reason: string;
}

/**
 * The dependency path from `ticketId` back to itself under the proposed edit,
 * or null when there is none. Walks the DAG with the proposal substituted in,
 * exactly as `ticket-edit-routes.ts` does — a cycle deadlocks the board, and
 * `pickNextTicket` would simply never offer any ticket on it.
 */
export function findDependencyCycle(
  ticketId: string,
  proposed: readonly string[],
  tickets: ReadonlyMap<string, Ticket>,
): string[] | null {
  const edges = (id: string): readonly string[] =>
    id === ticketId ? proposed : (tickets.get(id)?.dependsOn ?? []);
  const path: string[] = [ticketId];
  const seen = new Set<string>();
  const walk = (id: string): string[] | null => {
    for (const next of edges(id)) {
      path.push(next);
      if (next === ticketId) return [...path];
      if (!seen.has(next)) {
        seen.add(next);
        const found = walk(next);
        if (found) return found;
      }
      path.pop();
    }
    return null;
  };
  return walk(ticketId);
}

/**
 * Replaces a ticket's `dependsOn`. Refuses an unknown id or a cycle, naming
 * which — the same explain-refusal contract every other verb honours (FR-T4).
 */
export function retargetTicketDependencies(
  log: EventLog,
  input: RetargetDependenciesInput,
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
    const unknown = input.dependsOn.filter((id) => !tickets.has(id));
    if (unknown.length > 0) {
      throw new TicketError(
        'TICKET_NOT_FOUND',
        input.ticketId,
        `depends-on refused: no such ticket(s): ${unknown.join(', ')}`,
      );
    }
    if (input.dependsOn.includes(input.ticketId)) {
      throw new TicketError(
        'INVALID_TRANSITION',
        input.ticketId,
        `depends-on refused: ${input.ticketId} cannot depend on itself`,
      );
    }
    const cycle = findDependencyCycle(input.ticketId, input.dependsOn, tickets);
    if (cycle) {
      throw new TicketError(
        'INVALID_TRANSITION',
        input.ticketId,
        `depends-on refused: this would create a dependency cycle ` +
          `(${cycle.join(' -> ')}), and every ticket on a cycle is unclaimable ` +
          `forever because each waits on the others`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.dependencies_retargeted',
        actorId: input.actorId,
        ticketId: ticket.id,
        runId: opts.runId ?? null,
        payload: {
          from: ticket.dependsOn,
          to: [...input.dependsOn],
          reason: input.reason,
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
