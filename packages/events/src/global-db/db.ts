import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { computeDokimaHome } from '@dokima/shared';
import { applyGlobalMigrations } from './migrate.js';

/** A single writable/readable connection to the fleet-scope registry (DATABASE.md §7). */
export interface GlobalDb {
  readonly db: Database.Database;
  readonly path: string;
  close(): void;
}

export interface OpenGlobalDbOptions {
  /** Overrides `computeDokimaHome()`'s env source — tests only. */
  env?: NodeJS.ProcessEnv;
}

/** `~/.dokima/global.db` (relocatable via DOKIMA_HOME, same as `config.json`). */
export function defaultGlobalDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(computeDokimaHome(env), 'global.db');
}

/**
 * Opens the single writable connection to the fleet-scope registry
 * (DATABASE.md §7, D-013): same WAL/single-writer/migration discipline as a
 * project's `state.db` (`../db.ts`'s `openEventLog`) — `timeout: 0` fails a
 * second writer loudly (SQLITE_BUSY) instead of blocking. Unlike
 * `openEventLog`, this creates its own parent directory: a project's
 * `.dokima/` has an established caller-side `mkdir` (apps/server's
 * project registration flow); `~/.dokima/` has no such owner yet within
 * this ticket's write_scope, so a first-run open would otherwise ENOENT.
 */
export function openGlobalDb(dbPath?: string, opts: OpenGlobalDbOptions = {}): GlobalDb {
  const resolvedPath = dbPath ?? defaultGlobalDbPath(opts.env);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { timeout: 0 });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    applyGlobalMigrations(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return { db, path: resolvedPath, close: () => db.close() };
}

/** Read-only connection; WAL allows concurrent readers alongside the single writer. */
export function openGlobalDbReader(
  dbPath?: string,
  opts: OpenGlobalDbOptions = {},
): Database.Database {
  const resolvedPath = dbPath ?? defaultGlobalDbPath(opts.env);
  const db = new Database(resolvedPath, { readonly: true });
  db.pragma('foreign_keys = ON');
  return db;
}
