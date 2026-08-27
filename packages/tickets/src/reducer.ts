import type { EventRecord, Projection } from '@dokima/events';
import { TRANSITIONS } from './transitions.js';
import type { CreateTicketInput, Ticket, TicketHistoryEntry } from './types.js';

/** Payload shapes as they cross the event boundary (DATABASE.md §2 payload is TEXT/JSON). */
export type TicketCreatedPayload = Omit<CreateTicketInput, 'id'>;
export interface TicketClosedPayload {
  manifest: Ticket['manifest'];
}
export interface TicketCommentedPayload {
  body: string;
}

function pushHistory(
  ticket: Ticket,
  verb: TicketHistoryEntry['verb'],
  actorId: string,
  at: string,
  body?: string,
): TicketHistoryEntry[] {
  return [
    ...ticket.history,
    body === undefined ? { verb, actorId, at } : { verb, actorId, at, body },
  ];
}

/**
 * Pure fold of one event onto one ticket's state. Undefined input + a
 * non-`ticket.created` event is a no-op (the map-level projection only ever
 * calls this for events already routed to this ticket's id).
 */
export function reduceTicketEvent(
  ticket: Ticket | undefined,
  event: EventRecord,
): Ticket | undefined {
  switch (event.eventType) {
    case 'ticket.created': {
      if (ticket) return ticket; // created is not re-appliable
      const payload = event.payload as TicketCreatedPayload;
      const id = event.ticketId;
      if (!id) return ticket;
      return {
        id,
        type: payload.type,
        title: payload.title,
        lane: payload.lane,
        ownerId: null,
        status: 'ready',
        interface: payload.interface ?? null,
        // Events created before D-025 carry no `role`, and folding them must
        // keep meaning what it meant: no role => the coding-agent default,
        // decided at dispatch rather than backfilled here.
        ...(payload.role === undefined ? {} : { role: payload.role }),
        writeScope: payload.writeScope,
        dependsOn: payload.dependsOn ?? [],
        acceptance: payload.acceptance ?? [],
        verify: payload.verify ?? null,
        manifest: null,
        history: [],
        evidence: [],
        claimedAt: null,
        claimRunId: null,
        closedAt: null,
      };
    }
    case 'ticket.brief_set': {
      // W21-59: the founder's line to the maker. `interface` is what
      // buildHandoff renders as the context block, so this is the one field a
      // person can use to tell a stuck model something true about the project.
      if (!ticket) return ticket;
      const payload = event.payload as { to?: unknown };
      if (typeof payload.to !== 'string') return ticket;
      return { ...ticket, interface: payload.to };
    }
    case 'ticket.dependencies_retargeted': {
      // W21-51: a founder pointing a ticket at different work. No status
      // change — the DAG moves, the lifecycle does not.
      if (!ticket) return ticket;
      const payload = event.payload as { to?: unknown };
      if (!Array.isArray(payload.to)) return ticket;
      return { ...ticket, dependsOn: payload.to.map(String) };
    }
    /**
     * W21-71: the founder amending a criterion that proves nothing. Replaces
     * rather than merges — a criterion that returns the same answer with and
     * without the work is not something to keep alongside the fix for it.
     * `done` resets to false for every criterion, because a criterion nobody
     * has run yet has not been met, whatever the old one's flag said.
     */
    case 'ticket.acceptance_retargeted': {
      if (!ticket) return ticket;
      const payload = event.payload as { to?: unknown; reason?: unknown };
      if (!Array.isArray(payload.to)) return ticket;
      const texts = payload.to.filter((text): text is string => typeof text === 'string');
      if (texts.length === 0) return ticket;
      return {
        ...ticket,
        acceptance: texts.map((text, index) => ({ id: `AC-${index + 1}`, text, done: false })),
        history: pushHistory(
          ticket,
          'comment',
          event.actorId,
          event.createdAt,
          `acceptance retargeted to ${texts.join('; ')}${typeof payload.reason === 'string' && payload.reason ? ` — ${payload.reason}` : ''}`,
        ),
      };
    }

    case 'ticket.claimed': {
      if (!ticket || !isValid('claim', ticket.status)) return ticket;
      return {
        ...ticket,
        status: 'claimed',
        ownerId: event.actorId,
        claimedAt: event.createdAt,
        claimRunId: event.runId,
        history: pushHistory(ticket, 'claim', event.actorId, event.createdAt),
      };
    }
    case 'ticket.started': {
      if (!ticket || !isValid('start', ticket.status)) return ticket;
      return {
        ...ticket,
        status: 'in_progress',
        history: pushHistory(ticket, 'start', event.actorId, event.createdAt),
      };
    }
    case 'ticket.closed': {
      if (!ticket || !isValid('close', ticket.status)) return ticket;
      const payload = event.payload as TicketClosedPayload;
      return {
        ...ticket,
        status: 'in_review',
        manifest: payload.manifest,
        history: pushHistory(ticket, 'close', event.actorId, event.createdAt),
      };
    }
    case 'ticket.rejected': {
      // W21-42: back to Ready like a release, but by the REVIEWER — so the
      // owner is cleared and the next run claims it fresh.
      if (!ticket || !isValid('reject', ticket.status)) return ticket;
      return {
        ...ticket,
        status: 'ready',
        ownerId: null,
        claimedAt: null,
        claimRunId: null,
        history: pushHistory(ticket, 'reject', event.actorId, event.createdAt),
      };
    }
    case 'ticket.accepted': {
      if (!ticket || !isValid('accept', ticket.status)) return ticket;
      return {
        ...ticket,
        status: 'done',
        closedAt: event.createdAt,
        history: pushHistory(ticket, 'accept', event.actorId, event.createdAt),
      };
    }
    case 'ticket.released': {
      if (!ticket || !isValid('release', ticket.status)) return ticket;
      return {
        ...ticket,
        status: 'ready',
        ownerId: null,
        claimedAt: null,
        claimRunId: null,
        history: pushHistory(ticket, 'release', event.actorId, event.createdAt),
      };
    }
    /**
     * W21-27: the founder widening a ticket whose scope could not satisfy its
     * own acceptance. Append-only (C-6): this is a new event applied forward,
     * never an edit of the ticket.created row. Additive by construction — the
     * verb refuses a narrowing call, because past commits were scope-checked
     * against the wider set and narrowing would retroactively invalidate
     * checks that already passed.
     */
    case 'ticket.scope_widened': {
      if (!ticket) return ticket;
      const payload = event.payload as { added?: string[]; reason?: string };
      const added = payload.added ?? [];
      const merged = [...ticket.writeScope];
      for (const entry of added) if (!merged.includes(entry)) merged.push(entry);
      return {
        ...ticket,
        writeScope: merged,
        history: pushHistory(
          ticket,
          'comment',
          event.actorId,
          event.createdAt,
          `write_scope widened with ${added.join(', ')}${payload.reason ? ` — ${payload.reason}` : ''}`,
        ),
      };
    }

    case 'ticket.commented': {
      if (!ticket) return ticket;
      const payload = event.payload as TicketCommentedPayload;
      return {
        ...ticket,
        history: pushHistory(
          ticket,
          'comment',
          event.actorId,
          event.createdAt,
          payload.body,
        ),
      };
    }
    default:
      return ticket;
  }
}

function isValid(verb: keyof typeof TRANSITIONS, from: Ticket['status']): boolean {
  return (TRANSITIONS[verb].from as readonly Ticket['status'][]).includes(from);
}

/** Map-level projection (events package `Projection<S>` contract): id -> Ticket. */
export const ticketsProjection: Projection<ReadonlyMap<string, Ticket>> = {
  name: 'tickets',
  initial: () => new Map(),
  reduce(state, event) {
    if (!event.ticketId) return state;
    const updated = reduceTicketEvent(state.get(event.ticketId), event);
    if (!updated) return state;
    const next = new Map(state);
    next.set(event.ticketId, updated);
    return next;
  },
};
