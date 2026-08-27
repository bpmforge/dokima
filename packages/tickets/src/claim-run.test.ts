/**
 * W21-33. The fixture that matters replays the live sequence exactly:
 *
 *   #1274 claimed by run A -> #1279 released by run B -> #1303 receipt minted
 *
 * and asserts that the release is what stops, so the close can happen.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
import { getTicket } from './query.js';
import { claimTicket, closeTicket, releaseTicket, startTicket } from './verbs.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function fixture(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claim-run-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  createTicket(log, 'operator', {
    id: 'PLAN-1',
    type: 'task',
    title: 'a ticket two runs both think they hold',
    lane: 'solo',
    writeScope: ['src/**'],
  });
  return log;
}

const MANIFEST = {
  files: ['src/index.ts'],
  verify: { command: 'pnpm lint && pnpm typecheck && pnpm test', exitCode: 0 },
  commits: ['abc1234'],
};

describe('a claim belongs to a run (W21-33)', () => {
  it('RED FIXTURE: the live sequence — run B cannot release what run A claimed, and run A then closes', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    startTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });

    // The stale run's park handler, fourteen seconds later.
    expect(() =>
      releaseTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-B' }),
    ).toThrow(TicketError);

    // ...and because it could not, run A's close lands. This is the whole point.
    const closed = closeTicket(
      log,
      { ticketId: 'PLAN-1', actorId: 'operator', ...MANIFEST },
      { runId: 'run-A' },
    );
    expect(closed.status).toBe('in_review');
    log.close();
  });

  it('the refusal names both runs — a reader must not have to correlate timestamps', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    let caught: TicketError | undefined;
    try {
      releaseTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-B' });
    } catch (err) {
      caught = err as TicketError;
    }
    expect(caught!.code).toBe('STALE_RUN');
    expect(caught!.message).toContain('run-A');
    expect(caught!.message).toContain('run-B');
    log.close();
  });

  it('the run that DOES hold the claim releases it normally', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    const released = releaseTicket(
      log,
      { ticketId: 'PLAN-1', actorId: 'operator' },
      { runId: 'run-A' },
    );
    expect(released.status).toBe('ready');
    expect(released.claimRunId).toBeNull();
    log.close();
  });

  it('stealing stays possible, explicitly, and the event records who it was taken from and why', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    releaseTicket(
      log,
      {
        ticketId: 'PLAN-1',
        actorId: 'operator',
        steal: { reason: 'watchdog: no heartbeat for 20 minutes' },
      },
      { runId: 'run-B' },
    );
    const released = listEvents(log).find((e) => e.eventType === 'ticket.released');
    const steal = (released!.payload as { steal?: Record<string, unknown> }).steal;
    expect(steal).toMatchObject({ stolenFromRunId: 'run-A' });
    expect(String(steal!.reason)).toContain('watchdog');
    log.close();
  });

  it('a dead run’s claim never becomes permanent — the whole reason steal exists', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-dead' });
    startTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-dead' });
    releaseTicket(
      log,
      { ticketId: 'PLAN-1', actorId: 'operator', steal: { reason: 'orphaned claim' } },
      { runId: 'run-next' },
    );
    expect(getTicket(log, 'PLAN-1')!.status).toBe('ready');
    log.close();
  });

  it('a person at the API has no run and is still allowed — the guard fails open', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    const released = releaseTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' });
    expect(released.status).toBe('ready');
    log.close();
  });

  it('a claim made with no run is releasable by anyone — nothing to conflict with', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' });
    const released = releaseTicket(
      log,
      { ticketId: 'PLAN-1', actorId: 'operator' },
      { runId: 'run-B' },
    );
    expect(released.status).toBe('ready');
    log.close();
  });

  it('close is NOT run-guarded: a receipt from a run that is not the claimer still lands', () => {
    // Deliberate. A run guard on close would be a NEW way for a valid signed
    // receipt to fail, which is the failure this chapter exists to remove.
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    startTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    const closed = closeTicket(
      log,
      { ticketId: 'PLAN-1', actorId: 'operator', ...MANIFEST },
      { runId: 'run-other' },
    );
    expect(closed.status).toBe('in_review');
    log.close();
  });

  it('the claim run is folded from the event, not from a parameter nobody checks', () => {
    const log = fixture();
    claimTicket(log, { ticketId: 'PLAN-1', actorId: 'operator' }, { runId: 'run-A' });
    expect(getTicket(log, 'PLAN-1')!.claimRunId).toBe('run-A');
    log.close();
  });
});
