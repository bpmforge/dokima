/**
 * Proves 009_memory.sql applies cleanly through the REAL migration runner
 * (`@shipwright/events`' `openEventLog` -> `applyMigrations`, the
 * better-sqlite3-backed single-writer connection, ARCHITECTURE.md §4 law
 * 4) — every other test in this package uses `test-helpers.ts`'s
 * `createTestHandle` (node:sqlite, schema applied by reading the migration
 * file directly), which never exercises the external-content FTS5 triggers
 * against the actual engine a real caller will use. `memory` can't
 * statically import `@shipwright/events` (no package.json dependency in
 * this ticket's write_scope), so this dynamically imports it by absolute
 * `file://` URL — same technique as anti-jarvis-gap.test.ts/
 * manifest-gap.test.ts.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SqliteHandle } from './handle.js';
import { insertFact, markFactVerified } from './facts.js';
import { searchFactsBm25 } from './retrieval.js';

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

describe('009_memory.sql through the real @shipwright/events runner', () => {
  it('creates facts/facts_fts/calibration/working_findings, and FTS5 triggers stay in sync', async () => {
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
      expect(tables).toEqual(
        expect.arrayContaining(['facts', 'facts_fts', 'calibration', 'working_findings']),
      );

      // Real better-sqlite3 engine this time, not node:sqlite — proves the
      // external-content FTS5 triggers (facts_fts_ai/ad/au) actually fire.
      const fact = insertFact(
        log.db,
        {
          kind: 'fact',
          content: 'better-sqlite3 FTS5 trigger parity check',
          confidence: 0.7,
        },
        NOW,
      );
      markFactVerified(log.db, fact.id);
      const results = searchFactsBm25(log.db, 'trigger parity');
      expect(results).toHaveLength(1);
      expect(results[0]?.fact.id).toBe(fact.id);

      // Update path: facts_fts_au must delete-then-reinsert so the index reflects new content.
      log.db.exec(
        `UPDATE facts SET content = 'renamed content entirely' WHERE id = ${fact.id}`,
      );
      expect(searchFactsBm25(log.db, 'trigger parity')).toHaveLength(0);
      expect(searchFactsBm25(log.db, 'renamed content')).toHaveLength(1);

      // Delete path: facts_fts_ad must remove the fts row too. Checked directly
      // against facts_fts (not via searchFactsBm25's JOIN, which would hide an
      // orphaned fts row behind the missing facts row regardless of the trigger).
      log.db.exec(`DELETE FROM facts WHERE id = ${fact.id}`);
      const orphanCheck = log.db
        .prepare('SELECT rowid FROM facts_fts WHERE facts_fts MATCH ?')
        .all('renamed');
      expect(orphanCheck).toHaveLength(0);
    } finally {
      log.close();
      await temp.cleanup();
    }
  });
});
