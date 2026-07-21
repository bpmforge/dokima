/**
 * Proves 012_field_reports.sql applies cleanly through the REAL migration
 * runner (`@shipwright/events`' `openEventLog` -> `applyMigrations`, the
 * better-sqlite3-backed single-writer connection, ARCHITECTURE.md §4 law 4)
 * — every other test in this package uses `test-helpers.ts`'s
 * `createTestHandle` (node:sqlite, schema applied by reading the migration
 * files directly), which never exercises the real engine a production
 * caller uses. `memory` can't statically import `@shipwright/events` (no
 * package.json dependency in this ticket's write_scope), so this
 * dynamically imports it by absolute `file://` URL — same technique as
 * `../playbook/migration.integration.test.ts`.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SqliteHandle } from '../store/handle.js';
import { fileFieldReport } from './report.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

interface TempDb {
  dbPath: string;
  cleanup: () => Promise<void>;
}

interface EventsModule {
  openEventLog(dbPath: string): { db: SqliteHandle; close: () => void };
  createTempDbPath(): Promise<TempDb>;
}

async function loadEventsPackage(): Promise<EventsModule> {
  const [dbMod, testHelpersMod] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, 'packages', 'events', 'src', 'db.ts')).href),
    import(
      pathToFileURL(path.join(repoRoot, 'packages', 'events', 'src', 'test-helpers.ts'))
        .href
    ),
  ]);
  return {
    openEventLog: (dbMod as EventsModule).openEventLog,
    createTempDbPath: (testHelpersMod as EventsModule).createTempDbPath,
  };
}

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('012_field_reports.sql through the real @shipwright/events runner', () => {
  it('creates the field_reports table and fileFieldReport works against the real engine', async () => {
    const { openEventLog, createTempDbPath } = await loadEventsPackage();
    const temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    try {
      const tables = log.db
        .prepare<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(['field_reports']));

      const report = fileFieldReport(
        log.db,
        { source: 'manual', whatHappened: 'x', expected: 'y', filedBy: 'human-brad' },
        NOW,
      );
      expect(report.status).toBe('pending');

      expect(() =>
        log.db
          .prepare(
            `INSERT INTO field_reports (source, what_happened, expected, filed_by, filed_at, status)
             VALUES ('not-a-real-source', 'x', 'y', 'f', ?, 'pending')`,
          )
          .run(NOW()),
      ).toThrow();

      expect(() =>
        log.db
          .prepare(
            `INSERT INTO field_reports (source, what_happened, expected, filed_by, filed_at, status)
             VALUES ('manual', 'x', 'y', 'f', ?, 'not-a-real-status')`,
          )
          .run(NOW()),
      ).toThrow();
    } finally {
      log.close();
      await temp.cleanup();
    }
  });
});
