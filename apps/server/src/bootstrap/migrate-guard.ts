/**
 * Downgrade refusal + pre-migration backup (DEPLOYMENT.md §3): "newer
 * `user_version` refuses to open, loudly, rather than corrupting" and "a
 * pre-migration backup copy of `state.db` is written to `.dokima/backups/`
 * first." `packages/events/src/migrate.ts` (out of this ticket's write_scope)
 * applies migrations forward-only but never refuses a *newer* db — this
 * module adds that check in front of it, using only the public
 * `openEventLog`/`openEventLogReader` exports (no reach into migrate.ts's
 * internals): the "latest version this binary knows" is discovered by
 * migrating a throwaway `:memory:` database and reading its resulting
 * `user_version`, not by scanning `packages/events/migrations/` directly.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openEventLog, openEventLogReader } from '@dokima/events';

export interface SchemaCompatibility {
  /** `false` when the on-disk db is newer than this binary's latest known migration. */
  compatible: boolean;
  /** 0 when the db file does not exist yet (fresh project). */
  dbVersion: number;
  latestVersion: number;
  dbExists: boolean;
}

function readUserVersion(dbPath: string): number {
  const db = openEventLogReader(dbPath);
  try {
    return db.pragma('user_version', { simple: true }) as number;
  } finally {
    db.close();
  }
}

/** The highest schema version this binary applies, discovered via a scratch in-memory db. */
export function latestKnownSchemaVersion(): number {
  const log = openEventLog(':memory:');
  try {
    return log.db.pragma('user_version', { simple: true }) as number;
  } finally {
    log.close();
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkSchemaCompatibility(
  dbPath: string,
): Promise<SchemaCompatibility> {
  const latestVersion = latestKnownSchemaVersion();
  const dbExists = await fileExists(dbPath);
  if (!dbExists) {
    return { compatible: true, dbVersion: 0, latestVersion, dbExists: false };
  }
  const dbVersion = readUserVersion(dbPath);
  return {
    compatible: dbVersion <= latestVersion,
    dbVersion,
    latestVersion,
    dbExists: true,
  };
}

export class DowngradeRefusedError extends Error {
  constructor(
    public readonly dbPath: string,
    public readonly dbVersion: number,
    public readonly latestVersion: number,
  ) {
    super(
      `refusing to open ${dbPath}: its schema (user_version=${dbVersion}) is newer than ` +
        `this binary's latest known migration (user_version=${latestVersion}) — this ` +
        `looks like a downgrade. Reinstall the newer version, or restore a pre-migration ` +
        `backup from its .dokima/backups/ directory and reinstall the matching ` +
        `version (DEPLOYMENT.md §3).`,
    );
    this.name = 'DowngradeRefusedError';
  }
}

/**
 * Copies `state.db` (plus its `-wal`/`-shm` sidecars, if present under WAL
 * mode) into `backupsDir` before migrations run, named with the pre-migration
 * version so a restore always names the schema it came from. No-op (returns
 * `null`) when there is nothing to migrate — a fresh db or one already at the
 * latest version needs no backup.
 */
export async function backupBeforeMigrate(
  dbPath: string,
  backupsDir: string,
  compatibility: SchemaCompatibility,
  now: () => string = () => new Date().toISOString(),
): Promise<string | null> {
  if (!compatibility.dbExists) return null;
  if (compatibility.dbVersion >= compatibility.latestVersion) return null;

  await fs.mkdir(backupsDir, { recursive: true });
  const stamp = now().replace(/[:.]/g, '-');
  const backupPath = path.join(
    backupsDir,
    `state-v${compatibility.dbVersion}-${stamp}.db`,
  );
  await fs.copyFile(dbPath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (await fileExists(sidecar)) {
      await fs.copyFile(sidecar, `${backupPath}${suffix}`);
    }
  }
  return backupPath;
}
