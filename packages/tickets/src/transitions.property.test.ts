import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createIdentity, openEventLog } from '@shipwright/events';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  commentTicket,
  releaseTicket,
  startTicket,
} from './verbs.js';

const TICKET_IDS = ['T-A', 'T-B'] as const;
const ACTOR_IDS = ['actor-1', 'actor-2', 'actor-3'] as const;
const VERBS = ['claim', 'start', 'close', 'accept', 'release', 'comment'] as const;

const opArb = fc.record({
  verb: fc.constantFrom(...VERBS),
  ticketId: fc.constantFrom(...TICKET_IDS),
  actorId: fc.constantFrom(...ACTOR_IDS),
  filesOk: fc.boolean(),
  verifyExit: fc.constantFrom(0, 1),
  commitsOk: fc.boolean(),
});

interface Op {
  verb: (typeof VERBS)[number];
  ticketId: (typeof TICKET_IDS)[number];
  actorId: (typeof ACTOR_IDS)[number];
  filesOk: boolean;
  verifyExit: 0 | 1;
  commitsOk: boolean;
}

function applyOp(log: ReturnType<typeof openEventLog>, op: Op, now: () => string): void {
  try {
    switch (op.verb) {
      case 'claim':
        claimTicket(log, { ticketId: op.ticketId, actorId: op.actorId }, { now });
        return;
      case 'start':
        startTicket(log, { ticketId: op.ticketId, actorId: op.actorId }, { now });
        return;
      case 'close':
        closeTicket(
          log,
          {
            ticketId: op.ticketId,
            actorId: op.actorId,
            files: op.filesOk ? ['file.ts'] : [],
            commits: op.commitsOk ? ['abc'] : [],
            verify: { command: 'pnpm test', exitCode: op.verifyExit },
          },
          { now },
        );
        return;
      case 'accept':
        acceptTicket(log, { ticketId: op.ticketId, actorId: op.actorId }, { now });
        return;
      case 'release':
        releaseTicket(log, { ticketId: op.ticketId, actorId: op.actorId }, { now });
        return;
      case 'comment':
        commentTicket(
          log,
          { ticketId: op.ticketId, actorId: op.actorId, body: 'note' },
          { now },
        );
        return;
    }
  } catch (err) {
    if (err instanceof TicketError) return;
    throw err;
  }
}

describe('ticket lifecycle invariants (fast-check, FR-T1/FR-T2, TESTING.md §3)', () => {
  it('WIP=1 per actor holds and no ticket reaches done without a verified, distinct-reviewer close receipt', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let clock = 0;
        const now = (): string => {
          clock += 1;
          return new Date(2026, 0, 1, 0, 0, 0, clock).toISOString();
        };
        const log = openEventLog(':memory:');
        for (const actorId of ACTOR_IDS) {
          createIdentity(log, { id: actorId, name: actorId, kind: 'machine' });
        }
        for (const ticketId of TICKET_IDS) {
          createTicket(
            log,
            ACTOR_IDS[0],
            {
              id: ticketId,
              type: 'task',
              title: ticketId,
              lane: 'core',
              writeScope: [`packages/${ticketId}/**`],
            },
            { now },
          );
        }

        for (const op of ops) applyOp(log, op, now);

        const tickets = loadTickets(log);

        // (c) WIP=1 per actor: no actor owns more than one active ticket at
        // once. `in_review` does not count — close is what frees the worker
        // (source-system-amplifier.md "close-before-next-claim").
        for (const actorId of ACTOR_IDS) {
          const active = Array.from(tickets.values()).filter(
            (t) =>
              t.ownerId === actorId &&
              (t.status === 'claimed' || t.status === 'in_progress'),
          );
          expect(active.length).toBeLessThanOrEqual(1);
        }

        // (b) no path reaches `done` without a manifest carrying a verified
        // close receipt (>=1 commit, verify exit 0) and an accept by a
        // reviewer distinct from the receipt's owner.
        for (const ticket of tickets.values()) {
          if (ticket.status !== 'done') continue;
          const receipt = ticket.manifest?.closeReceipt;
          expect(receipt).toBeTruthy();
          expect(ticket.manifest?.verify.exitCode).toBe(0);
          expect(ticket.manifest?.commits.length ?? 0).toBeGreaterThan(0);
          const acceptEntry = [...ticket.history]
            .reverse()
            .find((h) => h.verb === 'accept');
          expect(acceptEntry).toBeTruthy();
          expect(acceptEntry?.actorId).not.toBe(receipt?.ownerId);
        }

        log.close();
      }),
      { numRuns: 200 },
    );
  });
});
