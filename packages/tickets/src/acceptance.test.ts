/**
 * W21-71. The live case: W21-50 refused PLAN-vault-002b because its criterion
 * `node --test src/crypto/argon2id.spec.ts` passed against the ticket's base
 * too — correct, and unactionable, because no verb could change a criterion.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { retargetTicketAcceptance } from './acceptance.js';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
import { getTicket } from './query.js';
import { acceptTicket, claimTicket, closeTicket, startTicket } from './verbs.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acceptance-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'founder', name: 'Founder', kind: 'human' });
  createIdentity(log, { id: 'maker', name: 'Maker', kind: 'machine' });
  createTicket(log, 'founder', {
    id: 'T-1',
    type: 'task',
    title: 'timing-safe compare',
    lane: 'crypto',
    writeScope: ['src/crypto/**'],
    acceptance: [{ id: 'AC-1', text: 'node --test spec.ts', done: false }],
  });
  return log;
}

const amend = (log: EventLog, criteria: string[], reason = 'W21-50 said it proves nothing') =>
  retargetTicketAcceptance(log, { ticketId: 'T-1', actorId: 'founder', criteria, reason });

describe('retargetTicketAcceptance', () => {
  it('replaces the criteria and renumbers them', () => {
    const log = board();
    const ticket = amend(log, ['node --test timing.spec.ts', 'npm run lint']);
    expect(ticket.acceptance.map((c) => [c.id, c.text])).toEqual([
      ['AC-1', 'node --test timing.spec.ts'],
      ['AC-2', 'npm run lint'],
    ]);
  });

  it('replaces rather than appends — the criterion that proved nothing is gone', () => {
    const log = board();
    const ticket = amend(log, ['node --test timing.spec.ts']);
    expect(ticket.acceptance).toHaveLength(1);
    expect(ticket.acceptance.map((c) => c.text)).not.toContain('node --test spec.ts');
  });

  it('records the old criteria and the reason in the ledger (C-6: append, never edit)', () => {
    const log = board();
    amend(log, ['node --test timing.spec.ts'], 'passes against base');
    const event = listEvents(log).find((e) => e.eventType === 'ticket.acceptance_retargeted');
    expect(event?.payload).toMatchObject({
      from: ['node --test spec.ts'],
      to: ['node --test timing.spec.ts'],
      reason: 'passes against base',
    });
  });

  it('resets done — a criterion nobody has run yet has not been met', () => {
    const log = board();
    const ticket = amend(log, ['node --test timing.spec.ts']);
    expect(ticket.acceptance.every((c) => c.done === false)).toBe(true);
  });

  it('refuses a done ticket, whose receipt names the criteria it was judged against', () => {
    const log = board();
    claimTicket(log, { ticketId: 'T-1', actorId: 'maker' });
    startTicket(log, { ticketId: 'T-1', actorId: 'maker' });
    closeTicket(log, {
      ticketId: 'T-1',
      actorId: 'maker',
      files: ['src/crypto/a.ts'],
      commits: ['abc1234'],
      verify: { command: 'node --test spec.ts', exitCode: 0 },
    });
    acceptTicket(log, { ticketId: 'T-1', actorId: 'founder' });
    expect(getTicket(log, 'T-1')?.status).toBe('done');
    expect(() => amend(log, ['node --test other.spec.ts'])).toThrow(TicketError);
  });

  it('refuses an empty criteria list — a ticket with no criterion can never close', () => {
    const log = board();
    expect(() => amend(log, [])).toThrow(TicketError);
    expect(() => amend(log, ['   '])).toThrow(TicketError);
  });

  it('refuses a missing reason — the next person has to see why the ask moved', () => {
    const log = board();
    expect(() => amend(log, ['node --test timing.spec.ts'], '  ')).toThrow(TicketError);
  });

  it('refuses an unknown ticket', () => {
    const log = board();
    expect(() =>
      retargetTicketAcceptance(log, {
        ticketId: 'nope',
        actorId: 'founder',
        criteria: ['x'],
        reason: 'y',
      }),
    ).toThrow(TicketError);
  });
});
