import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveAsset } from '@shipwright/shared';
import type Database from 'better-sqlite3';

// Anchored to the distribution root rather than to this file: a bundle
// collapses every source dir into one file, so the old '..' hop resolved to
// <bundle-dir>/migrations and died with ENOENT before the DB opened (W9-13).
const MIGRATIONS_DIR = resolveAsset('packages', 'events', 'migrations');

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
