/**
 * W21-42. The gap this closes is the one shape a review gate must never have:
 * `accept` refuses the owner (maker != verifier, C-4) while `release` from
 * in_review REQUIRES the owner, so the verifier identity could approve and
 * could not send work back.
 *
 * Hit twice live, from the founder's side both times:
 *
 *   $ dokima release PLAN-vault-002 --actor local-operator
 *   refused [NOT_OWNER]: actor local-operator does not own ticket
 *   PLAN-vault-002 (owner: operator)
 *
 * The first was a placeholder password hash that had passed every gate; the
 * second a ticket that landed having changed one line and skipped the file it
 * was created for. Both reviews were correct and unactionable.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
import { getTicket } from './query.js';
import { latestRejectionReason, rejectTicket } from './reject.js';
import { claimTicket, closeTicket, startTicket } from './verbs.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const MANIFEST = {
  files: ['src/crypto/argon2id.ts'],
  verify: { command: 'npm run typecheck', exitCode: 0 },
  commits: ['abc1234'],
};

/** A ticket in `in_review`, owned by the maker — the live shape. */
function reviewed(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reject-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Maker', kind: 'machine' });
  createIdentity(log, { id: 'local-operator', name: 'Founder', kind: 'human' });
  createTicket(log, 'local-operator', {
    id: 'PLAN-vault-002',
    type: 'task',
    title: 'Crypto wrappers',
    lane: 'vault-002',
    writeScope: ['src/crypto/**'],
  });
  claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' });
  startTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' });
  closeTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator', ...MANIFEST });
  return log;
}

const PLACEHOLDER =
  'hashPassword base64-encodes the password instead of hashing it, and ' +
  'verifyPassword returns true for any input.';

describe('rejectTicket (W21-42)', () => {
  it('RED FIXTURE: the founder who may ACCEPT may now also send it back', () => {
    const log = reviewed();
    const rejected = rejectTicket(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      reason: PLACEHOLDER,
    });
    expect(rejected.status).toBe('ready');
    expect(rejected.ownerId).toBeNull();
    log.close();
  });

  it('the MAKER cannot reject its own work either — the rule cuts both ways', () => {
    const log = reviewed();
    let caught: TicketError | undefined;
    try {
      rejectTicket(log, {
        ticketId: 'PLAN-vault-002',
        actorId: 'operator',
        reason: 'looks wrong',
      });
    } catch (err) {
      caught = err as TicketError;
    }
    expect(caught!.code).toBe('SELF_ACCEPT');
    expect(caught!.message).toContain('either direction');
    log.close();
  });

  it('A REASON IS REQUIRED — an accept has a receipt behind it, a rejection has only words', () => {
    const log = reviewed();
    expect(() =>
      rejectTicket(log, {
        ticketId: 'PLAN-vault-002',
        actorId: 'local-operator',
        reason: '   ',
      }),
    ).toThrow(/reason is required/);
    log.close();
  });

  it('the reason and the rejected owner are on the event (C-6)', () => {
    const log = reviewed();
    rejectTicket(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      reason: PLACEHOLDER,
    });
    const event = listEvents(log).find((e) => e.eventType === 'ticket.rejected');
    expect(event!.payload).toMatchObject({
      reason: PLACEHOLDER,
      rejectedOwner: 'operator',
    });
    log.close();
  });

  it('a ticket that is not in review cannot be rejected', () => {
    const log = reviewed();
    rejectTicket(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      reason: PLACEHOLDER,
    });
    // Now `ready` — rejecting again is not a transition that exists.
    expect(() =>
      rejectTicket(log, {
        ticketId: 'PLAN-vault-002',
        actorId: 'local-operator',
        reason: 'again',
      }),
    ).toThrow(/expected one of/);
    log.close();
  });

  it('the next claim starts clean — no owner, no claim run', () => {
    const log = reviewed();
    rejectTicket(log, {
      ticketId: 'PLAN-vault-002',
      actorId: 'local-operator',
      reason: PLACEHOLDER,
    });
    claimTicket(log, { ticketId: 'PLAN-vault-002', actorId: 'operator' }, { runId: 'run-next' });
    expect(getTicket(log, 'PLAN-vault-002')!.claimRunId).toBe('run-next');
    log.close();
  });
});

describe('latestRejectionReason (W21-42)', () => {
  it('the newest rejection wins, so a stale judgement never reaches a later attempt', () => {
    const events = [
      { eventType: 'ticket.rejected', ticketId: 'T-1', payload: { reason: 'first' } },
      { eventType: 'ticket.rejected', ticketId: 'T-1', payload: { reason: 'second' } },
    ];
    expect(latestRejectionReason(events, 'T-1')).toBe('second');
  });

  it('a later CLOSE clears it — the maker answered the judgement', () => {
    const events = [
      { eventType: 'ticket.rejected', ticketId: 'T-1', payload: { reason: 'first' } },
      { eventType: 'ticket.closed', ticketId: 'T-1', payload: {} },
    ];
    expect(latestRejectionReason(events, 'T-1')).toBeNull();
  });

  it('another ticket’s rejection is not this one’s', () => {
    const events = [
      { eventType: 'ticket.rejected', ticketId: 'T-2', payload: { reason: 'other' } },
    ];
    expect(latestRejectionReason(events, 'T-1')).toBeNull();
  });
});
