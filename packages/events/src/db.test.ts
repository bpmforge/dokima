import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from './append.js';
import { openEventLog } from './db.js';
import { createIdentity } from './identities.js';
import { applyMigrations } from './migrate.js';
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

  it('rejects UPDATE and DELETE on identities (append-only trigger)', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    expect(() =>
      log.db.exec("UPDATE identities SET kind = 'machine' WHERE id = 'human-1'"),
    ).toThrow(/append-only/i);
    expect(() => log.db.exec("DELETE FROM identities WHERE id = 'human-1'")).toThrow(
      /append-only/i,
    );
    log.close();
  });

  // W11-10: migration 013 (model_matrix.provider_id) is guarded by
  // `user_version` alone, not by tolerating its own re-application. A
  // rewound `user_version` that doesn't also undo 013's schema effect (the
  // scenario `boot-sequence.test.ts`'s pending-migration fixture creates,
  // and the one W10-68's reshaped recreate SQL was silently correct for at
  // the cost of resetting every `provider_id` to NULL) must make
  // `applyMigrations` refuse loudly, not succeed and discard data.
  it('refuses to silently re-apply migration 013 over a populated provider_id', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    log.db
      .prepare(
        `INSERT INTO model_matrix (role, task_type, provider_id, model, fallback, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'coder',
        'default',
        'lm-studio',
        'qwen/qwen3-coder-next',
        '[]',
        '2026-08-06T00:00:00.000Z',
      );

    // Simulate `user_version` rewound one step without undoing 013's own
    // effect — exactly the shape a stale pending-migration fixture (or a
    // real corrupted `user_version`) produces; a real prior-schema fixture
    // must also drop the `provider_id` column to be legitimate.
    log.db.pragma('user_version = 12');

    expect(() => applyMigrations(log.db)).toThrow(/duplicate column name/i);

    const row = log.db
      .prepare("SELECT provider_id FROM model_matrix WHERE role = 'coder'")
      .get() as { provider_id: string | null };
    expect(row.provider_id).toBe('lm-studio');
    expect(log.db.pragma('user_version', { simple: true })).toBe(12);

    log.close();
  });
});
