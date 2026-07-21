/**
 * `shipwright backup` (DEPLOYMENT.md §4/§8): a SQLite online backup via
 * `VACUUM INTO` — safe to run while the core has the db open (WAL allows
 * concurrent readers; `VACUUM INTO` only needs to *read* the source, so it
 * runs against a read-only connection rather than contending for the
 * single-writer lock, C6) — plus daily-copy retention pruning.
 *
 * Distinct filename prefix (`online-`) from `apps/server/src/bootstrap/
 * migrate-guard.ts`'s pre-migration safety copies (`state-v{n}-*.db`) so
 * retention pruning here never touches those — they are a different safety
 * mechanism with no expiry.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openEventLogReader } from '../db.js';

export const DEFAULT_RETENTION_COUNT = 7;
const BACKUP_PREFIX = 'online-';
const BACKUP_SUFFIX = '.db';

export interface CreateOnlineBackupOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
}

function backupFileName(now: () => string): string {
  return `${BACKUP_PREFIX}${now().replace(/[:.]/g, '-')}${BACKUP_SUFFIX}`;
}

/**
 * Performs the online backup (`VACUUM INTO`) of `dbPath` into `backupsDir`,
 * returning the path of the file just written. `VACUUM INTO` refuses to
 * overwrite an existing destination file, so the timestamped name must be
 * unique per call — safe even if `shipwright backup` runs more than once in
 * the same second-resolution instant only if `now()` also advances; callers
 * driving this from a real clock get a fresh name every call in practice.
 */
export async function createOnlineBackup(
  dbPath: string,
  backupsDir: string,
  opts: CreateOnlineBackupOptions = {},
): Promise<string> {
  const now = opts.now ?? (() => new Date().toISOString());
  await fs.mkdir(backupsDir, { recursive: true });
  const destPath = path.join(backupsDir, backupFileName(now));
  const db = openEventLogReader(dbPath);
  try {
    db.prepare('VACUUM INTO ?').run(destPath);
  } finally {
    db.close();
  }
  return destPath;
}

export interface PruneBackupsResult {
  kept: string[];
  pruned: string[];
}

/**
 * Keeps the `retentionCount` most recent online backups (by filename, which
 * sorts chronologically thanks to the ISO-derived timestamp) and deletes the
 * rest. Only touches this module's own `online-*.db` files — migrate-guard's
 * `state-v*.db` pre-migration copies are never pruned by this function.
 */
export async function pruneBackups(
  backupsDir: string,
  retentionCount: number = DEFAULT_RETENTION_COUNT,
): Promise<PruneBackupsResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(backupsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kept: [], pruned: [] };
    throw err;
  }
  const backups = entries
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .sort()
    .reverse(); // newest first (lexicographic == chronological here)

  const kept = backups.slice(0, retentionCount);
  const toPrune = backups.slice(retentionCount);
  for (const name of toPrune) {
    await fs.rm(path.join(backupsDir, name), { force: true });
  }
  return { kept, pruned: toPrune };
}
