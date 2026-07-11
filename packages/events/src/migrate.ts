import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

const MIGRATION_FILE_PATTERN = /^(\d+)_.*\.sql$/;

/**
 * Applies pending numbered SQL migrations from `packages/events/migrations/`
 * in order, each inside its own transaction, tracking position via
 * `PRAGMA user_version` (DATABASE.md §8). Forward-only — no down migrations.
 */
export function applyMigrations(db: Database.Database): void {
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
