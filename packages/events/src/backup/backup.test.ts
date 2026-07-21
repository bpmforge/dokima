import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from '../append.js';
import { openEventLog, openEventLogReader } from '../db.js';
import { createIdentity } from '../identities.js';
import { createTempDbPath, type TempDb } from '../test-helpers.js';
import { createOnlineBackup, pruneBackups } from './backup.js';

describe('createOnlineBackup', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('produces a valid, independent SQLite file with the same rows', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    appendEvent(log, {
      eventType: 'ticket.claimed',
      actorId: 'human-1',
      payload: { n: 1 },
    });

    const backupsDir = path.join(path.dirname(temp.dbPath), 'backups');
    const backupPath = await createOnlineBackup(temp.dbPath, backupsDir, {
      now: () => '2026-07-21T00:00:00.000Z',
    });
    log.close();

    expect(backupPath.startsWith(backupsDir)).toBe(true);
    const restored = openEventLogReader(backupPath);
    const rows = restored.prepare('SELECT * FROM events ORDER BY seq').all();
    expect(rows).toHaveLength(1);
    restored.close();
  });

  it('names each backup uniquely so retention has something to sort', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    const backupsDir = path.join(path.dirname(temp.dbPath), 'backups');

    const first = await createOnlineBackup(temp.dbPath, backupsDir, {
      now: () => '2026-07-19T00:00:00.000Z',
    });
    const second = await createOnlineBackup(temp.dbPath, backupsDir, {
      now: () => '2026-07-20T00:00:00.000Z',
    });
    log.close();

    expect(first).not.toBe(second);
    const files = await fs.readdir(backupsDir);
    expect(files).toHaveLength(2);
  });
});

describe('pruneBackups', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('keeps the N most recent online backups and deletes the rest', async () => {
    temp = await createTempDbPath();
    const backupsDir = path.join(path.dirname(temp.dbPath), 'backups');
    await fs.mkdir(backupsDir, { recursive: true });
    const days = ['17', '18', '19', '20', '21'];
    for (const d of days) {
      await fs.writeFile(
        path.join(backupsDir, `online-2026-07-${d}T00-00-00-000Z.db`),
        'x',
      );
    }

    const result = await pruneBackups(backupsDir, 3);

    expect(result.kept).toEqual([
      'online-2026-07-21T00-00-00-000Z.db',
      'online-2026-07-20T00-00-00-000Z.db',
      'online-2026-07-19T00-00-00-000Z.db',
    ]);
    expect(result.pruned.sort()).toEqual(
      ['online-2026-07-17T00-00-00-000Z.db', 'online-2026-07-18T00-00-00-000Z.db'].sort(),
    );
    const remaining = (await fs.readdir(backupsDir)).sort();
    expect(remaining).toEqual(result.kept.slice().sort());
  });

  it('never prunes migrate-guard pre-migration copies (different prefix)', async () => {
    temp = await createTempDbPath();
    const backupsDir = path.join(path.dirname(temp.dbPath), 'backups');
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(
      path.join(backupsDir, 'state-v3-2026-07-01T00-00-00-000Z.db'),
      'x',
    );
    await fs.writeFile(path.join(backupsDir, 'online-2026-07-21T00-00-00-000Z.db'), 'x');

    const result = await pruneBackups(backupsDir, 0);

    expect(result.pruned).toEqual(['online-2026-07-21T00-00-00-000Z.db']);
    const remaining = await fs.readdir(backupsDir);
    expect(remaining).toEqual(['state-v3-2026-07-01T00-00-00-000Z.db']);
  });

  it('is a no-op when the backups dir does not exist yet', async () => {
    const result = await pruneBackups('/nonexistent/does-not-exist-dir');
    expect(result).toEqual({ kept: [], pruned: [] });
  });
});
