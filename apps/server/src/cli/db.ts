import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openEventLog, openEventLogReader, type EventLog } from '@dokima/events';

/** Project-local state per DATABASE.md §5 — gitignored, travels with the repo dir. */
export const PROJECT_STATE_DIR = '.dokima';
export const PROJECT_STATE_FILE = 'state.db';

export function resolveDbPath(cwd: string, override?: string): string {
  if (override) return path.resolve(cwd, override);
  return path.join(cwd, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
}

/**
 * Opens the writable log for board/verb commands. Creates the `.dokima/`
 * directory on first use (better-sqlite3 does not create parent dirs) — verb
 * commands are the CLI's own single writer for the duration of the call
 * (C6); the connection closes before the process exits.
 */
export function openWritableLog(dbPath: string): EventLog {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return openEventLog(dbPath);
}

/** Read-only connection for `verify-chain` — refuses to conjure a log that doesn't exist yet. */
export function openReadOnlyLog(dbPath: string): EventLog {
  const db = openEventLogReader(dbPath);
  return { db, path: dbPath, close: () => db.close() };
}
