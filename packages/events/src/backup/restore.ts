/**
 * Restore = "put the file back" (DEPLOYMENT.md §4). `createOnlineBackup`'s
 * `VACUUM INTO` output is always a fresh, single-file db in `delete` journal
 * mode (no `-wal`/`-shm` sidecars of its own), but the *destination* may
 * still have stale WAL sidecars from the live db it's replacing — those must
 * go too, or a future `openEventLog` could try to replay a WAL that no
 * longer matches the restored main file.
 */

import { promises as fs } from 'node:fs';

async function removeIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

/** Copies `backupPath` over `dbPath`, clearing any stale WAL/SHM sidecars first. */
export async function restoreFromBackup(
  backupPath: string,
  dbPath: string,
): Promise<void> {
  await removeIfExists(dbPath);
  await removeIfExists(`${dbPath}-wal`);
  await removeIfExists(`${dbPath}-shm`);
  await fs.copyFile(backupPath, dbPath);
}
