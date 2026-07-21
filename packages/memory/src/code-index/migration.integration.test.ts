/**
 * Proves 011_code_index.sql applies cleanly through the REAL migration
 * runner (`@shipwright/events`' `openEventLog` -> `applyMigrations`, the
 * better-sqlite3-backed single-writer connection, ARCHITECTURE.md §4 law
 * 4) — mirrors `store/migration.integration.test.ts` for 009_memory.sql.
 * `memory` can't statically import `@shipwright/events` (no package.json
 * dependency in this ticket's write_scope), so this dynamically imports it
 * by absolute `file://` URL — same technique as
 * `store/migration.integration.test.ts`/`anti-jarvis-gap.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SqliteHandle } from '../store/handle.js';
import { insertCodeChunk } from './store.js';
import { searchCodeBm25 } from './search.js';

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

describe('011_code_index.sql through the real @shipwright/events runner', () => {
  it('creates code_chunks/code_chunks_fts, and FTS5 triggers stay in sync', async () => {
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
      expect(tables).toEqual(expect.arrayContaining(['code_chunks', 'code_chunks_fts']));

      // Real better-sqlite3 engine, not node:sqlite — proves the external-
      // content FTS5 triggers (code_chunks_fts_ai/ad/au) actually fire.
      const chunk = insertCodeChunk(
        log.db,
        {
          path: 'src/widget.ts',
          startLine: 1,
          endLine: 10,
          content: 'export function frobnicate() { return 1; }',
        },
        NOW,
      );
      const results = searchCodeBm25(log.db, 'frobnicate');
      expect(results).toHaveLength(1);
      expect(results[0]?.chunk.id).toBe(chunk.id);

      // Update path: code_chunks_fts_au must delete-then-reinsert so the index reflects new content.
      log.db.exec(
        `UPDATE code_chunks SET content = 'renamed entirely, no trace left' WHERE id = ${chunk.id}`,
      );
      expect(searchCodeBm25(log.db, 'frobnicate')).toHaveLength(0);
      expect(searchCodeBm25(log.db, 'renamed entirely')).toHaveLength(1);

      // Delete path: code_chunks_fts_ad must remove the fts row too.
      log.db.exec(`DELETE FROM code_chunks WHERE id = ${chunk.id}`);
      const orphanCheck = log.db
        .prepare('SELECT rowid FROM code_chunks_fts WHERE code_chunks_fts MATCH ?')
        .all('renamed');
      expect(orphanCheck).toHaveLength(0);
    } finally {
      log.close();
      await temp.cleanup();
    }
  });
});
