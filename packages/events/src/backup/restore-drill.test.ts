/**
 * Restore drill (W8-06 acceptance #2, DEPLOYMENT.md §4): "back up a seeded
 * project, corrupt the live DB, restore, audit verify green" — EXECUTED as a
 * test, not a doc promise. "Audit verify" here is the real primitive
 * `apps/server/src/cli/verify-chain.ts`'s `checkChain` is built on
 * (`verifyChain(listChainRows(log))`) — the same function the CLI's
 * `verify-chain` command reports through — not a bespoke re-check.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, listChainRows } from '../append.js';
import { openEventLog, openEventLogReader } from '../db.js';
import { verifyChain } from '../hash.js';
import { createIdentity } from '../identities.js';
import { createTempDbPath, type TempDb } from '../test-helpers.js';
import { createOnlineBackup } from './backup.js';
import { restoreFromBackup } from './restore.js';

describe('restore drill', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('backs up a seeded project, survives corruption of the live DB, and verifies green after restore', async () => {
    temp = await createTempDbPath();
    const backupsDir = path.join(path.dirname(temp.dbPath), 'backups');

    // Seed a small project: identity + a handful of chained events.
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    for (let i = 0; i < 5; i++) {
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'human-1',
        payload: { n: i },
      });
    }
    const seededRows = listChainRows(log);
    expect(verifyChain(seededRows).valid).toBe(true);
    log.close();

    // Back up the seeded (healthy) project.
    const backupPath = await createOnlineBackup(temp.dbPath, backupsDir);

    // Corrupt the live DB — truncate mid-file, simulating disk corruption /
    // a bad write. A live SQLite file starts with a 16-byte magic header;
    // truncating past it but mangling structure produces a genuinely broken
    // file, not just an empty one.
    const liveBytes = await fs.readFile(temp.dbPath);
    const corrupted = Buffer.from(liveBytes);
    for (let i = 100; i < Math.min(corrupted.length, 500); i++) {
      corrupted[i] = 0xff;
    }
    await fs.writeFile(temp.dbPath, corrupted);

    // The corrupted file must actually be broken — prove the drill isn't
    // vacuous by asserting the pre-restore state fails integrity.
    let corruptedIntegrityOk = true;
    try {
      const corruptedDb = openEventLogReader(temp.dbPath);
      try {
        const result = corruptedDb.pragma('integrity_check', { simple: true }) as string;
        corruptedIntegrityOk = result === 'ok';
      } finally {
        corruptedDb.close();
      }
    } catch {
      corruptedIntegrityOk = false;
    }
    expect(corruptedIntegrityOk).toBe(false);

    // Restore from the backup.
    await restoreFromBackup(backupPath, temp.dbPath);

    // Real audit verify, on the restored file: integrity_check + the actual
    // hash-chain walk (the same primitive `dokima verify-chain` reports).
    const restoredDb = openEventLogReader(temp.dbPath);
    try {
      expect(restoredDb.pragma('integrity_check', { simple: true })).toBe('ok');
      const restoredLog = { db: restoredDb, path: temp.dbPath, close: () => {} };
      const chainResult = verifyChain(listChainRows(restoredLog));
      expect(chainResult.valid).toBe(true);
      expect(chainResult.brokenAtSeq).toBeNull();
    } finally {
      restoredDb.close();
    }
  });
});
