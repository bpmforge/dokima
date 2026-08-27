/**
 * W21-32. The red fixture reproduces the live shape: a run mints a valid close
 * receipt, the ticket has been released out from under it, and `closeTicket`
 * refuses. Before this chapter that refusal produced NOTHING — the ledger held
 * a `gate.receipt_minted` with no `ticket.closed` and no explanation anywhere.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import { claimTicket, createTicket, releaseTicket, startTicket } from '@dokima/tickets';
import { CLOSE_REFUSED_EVENT, closeTicketLedgeringRefusal } from './loop-gates-close.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function fixture(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'close-refusal-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  createTicket(log, 'operator', {
    id: 'T-1',
    type: 'task',
    title: 'a ticket',
    lane: 'solo',
    writeScope: ['src/**'],
  });
  return log;
}

const MANIFEST = {
  files: ['src/index.ts'],
  verify: { command: 'pnpm test', exitCode: 0 },
  commits: ['abc1234'],
};

describe('closeTicketLedgeringRefusal (W21-32)', () => {
  it('RED FIXTURE: a refused close leaves a readable event — the live run left none', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    startTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    // The live shape: something else released the ticket while this run worked.
    releaseTicket(log, { ticketId: 'T-1', actorId: 'operator' });

    expect(() =>
      closeTicketLedgeringRefusal(
        log,
        { ticketId: 'T-1', actorId: 'operator', ...MANIFEST },
        { runId: 'run-live', receiptId: 'receipt-42' },
      ),
    ).toThrow();

    const refusals = listEvents(log).filter((e) => e.eventType === CLOSE_REFUSED_EVENT);
    expect(refusals).toHaveLength(1);
    const payload = refusals[0]!.payload as Record<string, unknown>;
    expect(refusals[0]!.ticketId).toBe('T-1');
    expect(refusals[0]!.runId).toBe('run-live');
    expect(payload.orphanedReceiptId).toBe('receipt-42');
    expect(String(payload.reason)).toContain('T-1');
    log.close();
  });

  it('the refusal names WHY — the reason code, not just that something failed', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    startTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    // A manifest with no commits: a different refusal, distinguishable in the
    // ledger from the ownership one without reading prose.
    expect(() =>
      closeTicketLedgeringRefusal(log, {
        ticketId: 'T-1',
        actorId: 'operator',
        files: ['src/index.ts'],
        verify: { command: 'pnpm test', exitCode: 0 },
        commits: [],
      }),
    ).toThrow();
    const refusal = listEvents(log).find((e) => e.eventType === CLOSE_REFUSED_EVENT);
    expect((refusal!.payload as Record<string, unknown>).code).toBe('MANIFEST_INVALID');
    log.close();
  });

  it('rethrows unchanged — it records, it does not recover, and the live code is INVALID_TRANSITION not NOT_OWNER', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    startTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    releaseTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    let caught: unknown;
    try {
      closeTicketLedgeringRefusal(log, { ticketId: 'T-1', actorId: 'operator', ...MANIFEST });
    } catch (err) {
      caught = err;
    }
    // The release put the ticket back in `ready`, so `assertTransition` refuses
    // before `assertOwner` is ever consulted. Worth pinning: the ownership
    // story is the CAUSE, but the code the ledger will show is the transition.
    expect((caught as { code?: string }).code).toBe('INVALID_TRANSITION');
    log.close();
  });

  it('a close that SUCCEEDS appends no refusal and returns the closed ticket', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    startTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    const closed = closeTicketLedgeringRefusal(
      log,
      { ticketId: 'T-1', actorId: 'operator', ...MANIFEST },
      { runId: 'run-live' },
    );
    expect(closed.status).toBe('in_review');
    expect(listEvents(log).filter((e) => e.eventType === CLOSE_REFUSED_EVENT)).toHaveLength(0);
    log.close();
  });
});

describe('lifecycle events carry a run id (W21-32)', () => {
  it('RED FIXTURE: claim/start/release/close stamp the run — every one ever written was run=null', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'T-1', actorId: 'operator' }, { runId: 'run-A' });
    startTicket(log, { ticketId: 'T-1', actorId: 'operator' }, { runId: 'run-A' });
    releaseTicket(log, { ticketId: 'T-1', actorId: 'operator' }, { runId: 'run-A' });
    const runs = listEvents(log)
      .filter((e) => e.eventType.startsWith('ticket.') && e.eventType !== 'ticket.created')
      .map((e) => e.runId);
    expect(runs).toEqual(['run-A', 'run-A', 'run-A']);
    log.close();
  });

  it('no run id stays null — a person at the API has no run, and a fake one would be worse', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'T-1', actorId: 'operator' });
    const claimed = listEvents(log).find((e) => e.eventType === 'ticket.claimed');
    expect(claimed!.runId).toBeNull();
    log.close();
  });
});
