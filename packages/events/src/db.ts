import Database from 'better-sqlite3';
import { applyMigrations } from './migrate.js';
import { sweepOrphans } from './persist.js';
import type { EventLog } from './types.js';

export interface OpenEventLogOptions {
  /**
   * If set, an orphan sweep runs immediately after migrations (NFR-3): any
   * `<op>.started` event left unresolved by a prior crash gets a
   * `<op>.orphaned` event appended, attributed to this identity. The
   * identity must already exist (events.actor_id is FK-enforced).
   */
  systemActorId?: string;
  now?: () => string;
}

/**
 * Opens the single writable connection to a project's event log (C6).
 * `timeout: 0` makes a second writer's lock attempt fail immediately
 * (SQLITE_BUSY) instead of blocking — "fails loudly" is a synchronous,
 * deterministic property of better-sqlite3, not something to layer an
 * app-level lockfile on top of.
 */
export function openEventLog(dbPath: string, opts: OpenEventLogOptions = {}): EventLog {
  const db = new Database(dbPath, { timeout: 0 });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  } catch (err) {
    db.close();
    throw err;
  }
  const log: EventLog = {
    db,
    path: dbPath,
    close: () => db.close(),
  };
  if (opts.systemActorId) {
    sweepOrphans(log, opts.systemActorId, { now: opts.now });
  }
  return log;
}

/** Read-only connection (CLI/tooling); WAL allows concurrent readers. */
export function openEventLogReader(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true });
  db.pragma('foreign_keys = ON');
  return db;
}
