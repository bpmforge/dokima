import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from './append.js';
import { openEventLog } from './db.js';
import { createIdentity } from './identities.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

describe('openEventLog', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('enables WAL mode and foreign keys', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    expect(log.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(log.db.pragma('foreign_keys', { simple: true })).toBe(1);
    log.close();
  });

  it('applies migrations, creating events + identities tables', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    const tables = log.db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(['events', 'identities']));
    expect(log.db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
    log.close();
  });

  it('is idempotent across repeated opens of the same file', async () => {
    temp = await createTempDbPath();
    const first = openEventLog(temp.dbPath);
    first.close();
    const second = openEventLog(temp.dbPath);
    expect(second.db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
    second.close();
  });

  it('rejects an event referencing an unknown actor (FK enforcement)', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    expect(() =>
      appendEvent(log, { eventType: 'ticket.created', actorId: 'ghost', payload: null }),
    ).toThrow(/FOREIGN KEY/i);
    log.close();
  });

  it('rejects UPDATE and DELETE on events (append-only trigger)', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    appendEvent(log, { eventType: 'ticket.created', actorId: 'human-1', payload: null });
    expect(() =>
      log.db.exec("UPDATE events SET event_type = 'tampered' WHERE seq = 1"),
    ).toThrow(/append-only/i);
    expect(() => log.db.exec('DELETE FROM events WHERE seq = 1')).toThrow(/append-only/i);
    log.close();
  });

  it('rejects an identity with an invalid kind (CHECK constraint)', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    expect(() =>
      log.db
        .prepare(
          'INSERT INTO identities (id, name, kind, created_at) VALUES (?, ?, ?, ?)',
        )
        .run('bad', 'Bad', 'robot', '2026-07-11T00:00:00.000Z'),
    ).toThrow(/CHECK/i);
    log.close();
  });
});
