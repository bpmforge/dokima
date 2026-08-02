import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import { claimTicket, createTicket, getTicket, startTicket } from '@dokima/tickets';
import { checkWatchdogBreach, deadLetterAndBlock } from './watchdog.js';

describe('checkWatchdogBreach', () => {
  it('reports no breach while under both limits', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 10, heartbeatStallSeconds: 5 },
      { startedAtMs: 0, lastHeartbeatAtMs: 0 },
      1_000,
    );
    expect(breach).toBeNull();
  });

  it('breaches on the wall-clock ceiling even with a fresh heartbeat', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 10, heartbeatStallSeconds: 60 },
      { startedAtMs: 0, lastHeartbeatAtMs: 9_999 },
      10_000,
    );
    expect(breach).toEqual({
      reason: 'max_session_seconds',
      elapsedMs: 10_000,
      sinceLastHeartbeatMs: 1,
    });
  });

  it('breaches on heartbeat stall before the wall-clock ceiling', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 60, heartbeatStallSeconds: 5 },
      { startedAtMs: 0, lastHeartbeatAtMs: 1_000 },
      6_000,
    );
    expect(breach).toEqual({
      reason: 'heartbeat_stall',
      elapsedMs: 6_000,
      sinceLastHeartbeatMs: 5_000,
    });
  });

  it('never reports a stall past the wall-clock ceiling — max_session_seconds wins', () => {
    const breach = checkWatchdogBreach(
      { maxSessionSeconds: 5, heartbeatStallSeconds: 5 },
      { startedAtMs: 0, lastHeartbeatAtMs: 0 },
      5_000,
    );
    expect(breach?.reason).toBe('max_session_seconds');
  });
});

interface Fixture {
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-watchdog-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  return {
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

describe('deadLetterAndBlock', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('mints a session.dead_letter event and auto-blocks the ticket with evidence', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Hung ticket',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });
    startTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });

    deadLetterAndBlock({
      log,
      actorId: 'worker-1',
      ticketId: 'T-1',
      runId: 'run-1',
      breach: {
        reason: 'heartbeat_stall',
        elapsedMs: 4_200,
        sinceLastHeartbeatMs: 3_000,
      },
    });

    const deadLetterEvents = listEvents(log).filter(
      (e) => e.eventType === 'session.dead_letter',
    );
    expect(deadLetterEvents).toHaveLength(1);
    expect(deadLetterEvents[0]).toMatchObject({
      ticketId: 'T-1',
      runId: 'run-1',
      actorId: 'worker-1',
      payload: {
        reason: 'heartbeat_stall',
        elapsedMs: 4_200,
        sinceLastHeartbeatMs: 3_000,
      },
    });

    const ticket = getTicket(log, 'T-1');
    expect(ticket?.status).toBe('ready');
    expect(ticket?.ownerId).toBeNull();
    const evidenceComment = ticket?.history.findLast((entry) => entry.verb === 'comment');
    expect(evidenceComment?.body).toEqual(
      expect.stringContaining('watchdog terminated the session tree (heartbeat_stall'),
    );
  });

  it('records a null runId when none is given', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-2',
      type: 'task',
      title: 'Hung ticket 2',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'T-2', actorId: 'worker-1' });
    startTicket(log, { ticketId: 'T-2', actorId: 'worker-1' });

    deadLetterAndBlock({
      log,
      actorId: 'worker-1',
      ticketId: 'T-2',
      breach: {
        reason: 'max_session_seconds',
        elapsedMs: 9_999,
        sinceLastHeartbeatMs: 100,
      },
    });

    const [event] = listEvents(log).filter((e) => e.eventType === 'session.dead_letter');
    expect(event?.runId).toBeNull();
  });
});
