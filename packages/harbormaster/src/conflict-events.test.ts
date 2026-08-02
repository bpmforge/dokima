import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import {
  hasPendingConflict,
  mintConflictDetected,
  mintConflictParked,
  mintConflictRebased,
  mintHumanFileEdited,
} from './conflict-events.js';

interface Fixture {
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-conflict-events-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createIdentity(log, { id: 'human-1', name: 'P2 Dev', kind: 'human' });
  createTicket(log, 'worker-1', {
    id: 'T-1',
    type: 'task',
    title: 'Auth ticket',
    lane: 'core',
    writeScope: ['src/auth/**'],
    verify: 'true',
  });
  return {
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

describe('hasPendingConflict', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('is false before any conflict is detected', async () => {
    fixture = await setupFixture();
    expect(hasPendingConflict(fixture.log, 'T-1')).toBe(false);
  });

  it('is true once conflict.detected lands, until conflict.rebased resolves it', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    mintConflictDetected(log, 'worker-1', {
      ticketId: 'T-1',
      ownerId: 'worker-1',
      path: 'src/auth/session.ts',
      matchedGlob: 'src/auth/**',
    });
    expect(hasPendingConflict(log, 'T-1')).toBe(true);

    mintConflictRebased(log, 'worker-1', 'T-1', { baseRef: 'main', ontoSha: 'deadbeef' });
    expect(hasPendingConflict(log, 'T-1')).toBe(false);
  });

  it('resolves via conflict.parked too, and re-arms on a fresh conflict.detected', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    mintConflictDetected(log, 'worker-1', {
      ticketId: 'T-1',
      ownerId: 'worker-1',
      path: 'src/auth/session.ts',
      matchedGlob: 'src/auth/**',
    });
    mintConflictParked(log, 'worker-1', 'T-1', {
      conflictedPaths: ['src/auth/session.ts'],
    });
    expect(hasPendingConflict(log, 'T-1')).toBe(false);

    mintConflictDetected(log, 'worker-1', {
      ticketId: 'T-1',
      ownerId: 'worker-1',
      path: 'src/auth/session.ts',
      matchedGlob: 'src/auth/**',
    });
    expect(hasPendingConflict(log, 'T-1')).toBe(true);
  });

  it('ignores conflicts on other tickets', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-2',
      type: 'task',
      title: 'Other ticket',
      lane: 'core',
      writeScope: ['src/other/**'],
      verify: 'true',
    });
    mintConflictDetected(log, 'worker-1', {
      ticketId: 'T-2',
      ownerId: 'worker-1',
      path: 'src/other/file.ts',
      matchedGlob: 'src/other/**',
    });
    expect(hasPendingConflict(log, 'T-1')).toBe(false);
  });
});

describe('mintHumanFileEdited', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('attributes the event to the human identity, not the harbormaster actor', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    const event = mintHumanFileEdited(log, 'human-1', 'T-1', {
      path: 'src/auth/session.ts',
    });
    expect(event.actorId).toBe('human-1');
    expect(event.ticketId).toBe('T-1');
    expect(event.payload).toEqual({ path: 'src/auth/session.ts' });
  });

  it('accepts a null ticketId for an edit outside any lease', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    const event = mintHumanFileEdited(log, 'human-1', null, { path: 'docs/README.md' });
    expect(event.ticketId).toBeNull();
  });
});
