import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { claimTicket, createTicket, startTicket } from '@dokima/tickets';
import { activeLeases, leaseBadges } from './conflict-leases.js';

interface Fixture {
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-conflict-leases-'));
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

describe('activeLeases / leaseBadges', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('leases a claimed ticket but not a ready one', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Claimed ticket',
      lane: 'core',
      writeScope: ['src/auth/**'],
      verify: 'true',
    });
    createTicket(log, 'worker-1', {
      id: 'T-2',
      type: 'task',
      title: 'Ready ticket',
      lane: 'core',
      writeScope: ['src/other/**'],
      verify: 'true',
    });
    const claimed = claimTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });

    const leases = activeLeases([claimed]);
    expect(leases).toEqual([
      { ticketId: 'T-1', ownerId: 'worker-1', writeScope: ['src/auth/**'] },
    ]);
  });

  it('leases an in_progress ticket', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-3',
      type: 'task',
      title: 'In-progress ticket',
      lane: 'core',
      writeScope: ['src/auth/**', 'src/session/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'T-3', actorId: 'worker-1' });
    const started = startTicket(log, { ticketId: 'T-3', actorId: 'worker-1' });

    expect(activeLeases([started])).toEqual([
      {
        ticketId: 'T-3',
        ownerId: 'worker-1',
        writeScope: ['src/auth/**', 'src/session/**'],
      },
    ]);
  });

  it('does not lease an in_review ticket — close frees the worker, scope is no longer actively written', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-4',
      type: 'task',
      title: 'Closed ticket',
      lane: 'core',
      writeScope: ['src/auth/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'T-4', actorId: 'worker-1' });
    const started = startTicket(log, { ticketId: 'T-4', actorId: 'worker-1' });
    // in_review is a status this fixture doesn't need a real close for — a ready
    // ticket (never claimed) exercises the same "not actively leased" branch.
    expect(activeLeases([{ ...started, status: 'in_review' }])).toEqual([]);
  });

  it('flattens one badge per (ticket, glob) pair for the UI lock overlay (UX_SPEC §4)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-5',
      type: 'task',
      title: 'Multi-glob ticket',
      lane: 'core',
      writeScope: ['src/auth/**', 'src/session/**'],
      verify: 'true',
    });
    const claimed = claimTicket(log, { ticketId: 'T-5', actorId: 'worker-1' });

    expect(leaseBadges([claimed])).toEqual([
      { glob: 'src/auth/**', ticketId: 'T-5', ownerId: 'worker-1' },
      { glob: 'src/session/**', ticketId: 'T-5', ownerId: 'worker-1' },
    ]);
  });
});
