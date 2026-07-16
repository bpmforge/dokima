import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

const MIGRATION_FILE_PATTERN = /^(\d+)_.*\.sql$/;

/**
 * Applies pending numbered SQL migrations from `global-db/migrations/` in
 * order, each inside its own transaction, tracking position via
 * `PRAGMA user_version` — the same forward-only discipline `../migrate.ts`
 * applies to a project's `state.db` (DATABASE.md §8), duplicated here as a
 * separate migrations dir/runner because this ticket's write_scope
 * (`packages/events/src/global-db/**`) does not include `../migrate.ts`.
 */
export function applyGlobalMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort();
  for (const file of files) {
    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (!match) continue;
    const version = Number(match[1]);
    if (version <= currentVersion) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
