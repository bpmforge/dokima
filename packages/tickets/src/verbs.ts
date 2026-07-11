import { appendEvent, type EventLog } from '@shipwright/events';
import type { TicketVerbOptions } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import { isValidTransition, TRANSITIONS, type LifecycleVerb } from './transitions.js';
import type { CloseReceipt, Ticket, TicketManifest, VerifyResult } from './types.js';

function requireTicket(tickets: ReadonlyMap<string, Ticket>, ticketId: string): Ticket {
  const ticket = tickets.get(ticketId);
  if (!ticket) {
    throw new TicketError(
      'TICKET_NOT_FOUND',
      ticketId,
      `ticket ${ticketId} does not exist`,
    );
  }
  return ticket;
}

function assertTransition(verb: Exclude<LifecycleVerb, 'comment'>, ticket: Ticket): void {
  if (!isValidTransition(verb, ticket.status)) {
    throw new TicketError(
      'INVALID_TRANSITION',
      ticket.id,
      `${verb} refused: ticket ${ticket.id} is ${ticket.status}, expected one of ` +
        `[${TRANSITIONS[verb].from.join(', ')}]`,
    );
  }
}

function assertOwner(ticket: Ticket, actorId: string, verb: string): void {
  if (ticket.ownerId !== actorId) {
    throw new TicketError(
      'NOT_OWNER',
      ticket.id,
      `${verb} refused: actor ${actorId} does not own ticket ${ticket.id} ` +
        `(owner: ${ticket.ownerId ?? 'none'})`,
    );
  }
}

/** WIP=1 per actor (FR-T1): claimed/in_progress/in_review count as active ownership. */
function isActiveOwnership(status: Ticket['status']): boolean {
  return status === 'claimed' || status === 'in_progress' || status === 'in_review';
}

export interface ClaimTicketInput {
  ticketId: string;
  actorId: string;
}

export function claimTicket(
  log: EventLog,
  input: ClaimTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = requireTicket(tickets, input.ticketId);
    assertTransition('claim', ticket);
    const activeElsewhere = Array.from(tickets.values()).some(
      (other) =>
        other.id !== ticket.id &&
        other.ownerId === input.actorId &&
        isActiveOwnership(other.status),
    );
    if (activeElsewhere) {
      throw new TicketError(
        'WIP_LIMIT',
        ticket.id,
        `claim refused: actor ${input.actorId} already owns an active ticket (WIP=1 per actor)`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.claimed',
        actorId: input.actorId,
        ticketId: ticket.id,
        payload: {},
      },
      opts,
    );
    return requireTicket(loadTickets(log), ticket.id);
  })();
}

export interface StartTicketInput {
  ticketId: string;
  actorId: string;
}

export function startTicket(
  log: EventLog,
  input: StartTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = requireTicket(tickets, input.ticketId);
    assertTransition('start', ticket);
    assertOwner(ticket, input.actorId, 'start');
    appendEvent(
      log,
      {
        eventType: 'ticket.started',
        actorId: input.actorId,
        ticketId: ticket.id,
        payload: {},
      },
      opts,
    );
    return requireTicket(loadTickets(log), ticket.id);
  })();
}

export interface CloseTicketInput {
  ticketId: string;
  actorId: string;
  files: string[];
  verify: VerifyResult;
  commits: string[];
}

/**
 * Refuses without a non-empty file list, a passing (`exitCode === 0`) verify
 * result, and at least one attached commit (FR-T2); on success mints a close
 * receipt embedded verbatim in the manifest for `accept` to check later.
 * Trusts the caller's stated evidence structurally — re-running `verify` and
 * stat-ing the claimed files against disk is the out-of-session Harbormaster
 * gate (FR-H1), outside this package's write_scope.
 */
export function closeTicket(
  log: EventLog,
  input: CloseTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = requireTicket(tickets, input.ticketId);
    assertTransition('close', ticket);
    assertOwner(ticket, input.actorId, 'close');
    if (
      input.files.length === 0 ||
      input.commits.length === 0 ||
      input.verify.exitCode !== 0
    ) {
      throw new TicketError(
        'MANIFEST_INVALID',
        ticket.id,
        `close refused: manifest requires >=1 file, >=1 commit, and verify exit 0 ` +
          `(got files=${input.files.length}, commits=${input.commits.length}, ` +
          `verifyExit=${input.verify.exitCode})`,
      );
    }
    const now = opts.now ?? (() => new Date().toISOString());
    const mintedAt = now();
    const closeReceipt: CloseReceipt = {
      ticketId: ticket.id,
      ownerId: input.actorId,
      verify: input.verify,
      commits: input.commits,
      files: input.files,
      mintedAt,
    };
    const manifest: TicketManifest = {
      files: input.files,
      verify: input.verify,
      commits: input.commits,
      closeReceipt,
    };
    appendEvent(
      log,
      {
        eventType: 'ticket.closed',
        actorId: input.actorId,
        ticketId: ticket.id,
        payload: { manifest },
      },
      { now: () => mintedAt },
    );
    return requireTicket(loadTickets(log), ticket.id);
  })();
}

export interface AcceptTicketInput {
  ticketId: string;
  actorId: string;
}

/**
 * Reviewer identity ≠ owner identity (FR-T2, maker≠verifier — CLAUDE.md law
 * 5); reads ONLY the manifest already folded from `ticket.closed` — there is
 * no caller-supplied manifest parameter, so accept cannot be used to smuggle
 * in a receipt that wasn't actually minted by `close`.
 */
export function acceptTicket(
  log: EventLog,
  input: AcceptTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = requireTicket(tickets, input.ticketId);
    assertTransition('accept', ticket);
    if (ticket.ownerId === input.actorId) {
      throw new TicketError(
        'SELF_ACCEPT',
        ticket.id,
        `accept refused: reviewer ${input.actorId} is also the owner of ${ticket.id} ` +
          `(maker != verifier)`,
      );
    }
    if (!ticket.manifest?.closeReceipt) {
      throw new TicketError(
        'MISSING_CLOSE_RECEIPT',
        ticket.id,
        `accept refused: manifest for ${ticket.id} does not embed a close receipt`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.accepted',
        actorId: input.actorId,
        ticketId: ticket.id,
        payload: {},
      },
      opts,
    );
    return requireTicket(loadTickets(log), ticket.id);
  })();
}

export interface ReleaseTicketInput {
  ticketId: string;
  actorId: string;
}

export function releaseTicket(
  log: EventLog,
  input: ReleaseTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = requireTicket(tickets, input.ticketId);
    assertTransition('release', ticket);
    assertOwner(ticket, input.actorId, 'release');
    appendEvent(
      log,
      {
        eventType: 'ticket.released',
        actorId: input.actorId,
        ticketId: ticket.id,
        payload: {},
      },
      opts,
    );
    return requireTicket(loadTickets(log), ticket.id);
  })();
}

export interface CommentTicketInput {
  ticketId: string;
  actorId: string;
  body: string;
}

/** No status change, any status — evidence/history only (API_DESIGN.md `POST /tickets/{id}/comment`). */
export function commentTicket(
  log: EventLog,
  input: CommentTicketInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = requireTicket(tickets, input.ticketId);
    appendEvent(
      log,
      {
        eventType: 'ticket.commented',
        actorId: input.actorId,
        ticketId: ticket.id,
        payload: { body: input.body },
      },
      opts,
    );
    return requireTicket(loadTickets(log), ticket.id);
  })();
}
