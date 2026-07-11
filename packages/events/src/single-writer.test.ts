import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { appendEvent } from './append.js';
import { openEventLog } from './db.js';
import { createIdentity } from './identities.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

describe('single-writer discipline (C6)', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('a second connection writing while the first holds the write lock fails immediately, not after a retry delay', async () => {
    temp = await createTempDbPath();
    const writerA = openEventLog(temp.dbPath);
    createIdentity(writerA, { id: 'human-1', name: 'Operator', kind: 'human' });

    // Hold the write lock open on connection A without committing.
    writerA.db.exec('BEGIN IMMEDIATE');

    const writerB = openEventLog(temp.dbPath);
    const start = Date.now();
    let thrown: unknown;
    try {
      appendEvent(writerB, {
        eventType: 'ticket.created',
        actorId: 'human-1',
        payload: null,
      });
    } catch (err) {
      thrown = err;
    }
    const elapsedMs = Date.now() - start;

    expect(thrown).toBeInstanceOf(Database.SqliteError);
    expect((thrown as InstanceType<typeof Database.SqliteError>).code).toMatch(/BUSY/);
    // timeout: 0 means no internal busy-retry loop — this must fail fast.
    expect(elapsedMs).toBeLessThan(500);

    writerA.db.exec('ROLLBACK');
    writerA.close();
    writerB.close();
  });

  it('a second writer succeeds once the first releases the lock', async () => {
    temp = await createTempDbPath();
    const writerA = openEventLog(temp.dbPath);
    createIdentity(writerA, { id: 'human-1', name: 'Operator', kind: 'human' });
    appendEvent(writerA, {
      eventType: 'ticket.created',
      actorId: 'human-1',
      payload: null,
    });
    writerA.close();

    const writerB = openEventLog(temp.dbPath);
    const record = appendEvent(writerB, {
      eventType: 'ticket.claimed',
      actorId: 'human-1',
      payload: null,
    });
    expect(record.seq).toBe(2);
    writerB.close();
  });
});
