/**
 * `dokima restore <backup-file>` (W19-03): the read-back half `dokima backup`
 * never had. `restoreFromBackup` (packages/events/src/backup/restore.ts) sat
 * exported, tested by its own restore drill, and reachable from nothing — a
 * founder with backups on disk had no supported way to use one.
 *
 * Deliberately blunt about what it does: the current state.db is REPLACED by
 * the named backup (stale WAL/SHM sidecars cleared first, per restore.ts).
 * It refuses when the core may be running (a live single writer over a file
 * swap is how a hash chain gets forked) — stop the service first.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { restoreFromBackup } from '@dokima/events';
import { resolveProjectPaths } from '../../bootstrap/config.js';
import type { CliIO } from '../../bootstrap/cli.js';

export interface RestoreCommandDeps {
  restoreFromBackup?: typeof restoreFromBackup;
}

export async function runRestoreCommand(
  argv: string[],
  io: CliIO,
  deps: RestoreCommandDeps = {},
): Promise<number> {
  const backupArg = argv[0];
  if (!backupArg) {
    io.stderr('usage: dokima restore <backup-file>  (see .dokima/backups/)');
    return 2;
  }
  const paths = resolveProjectPaths(io.cwd);
  const backupPath = path.resolve(io.cwd, backupArg);
  try {
    await fs.access(backupPath);
  } catch {
    io.stderr(`restore refused: no backup file at ${backupPath}`);
    return 1;
  }

  const impl = deps.restoreFromBackup ?? restoreFromBackup;
  try {
    await impl(backupPath, paths.dbPath);
  } catch (err) {
    io.stderr(`restore failed: ${(err as Error).message}`);
    return 1;
  }
  io.stdout(`restore: ${paths.dbPath} replaced from ${backupPath}`);
  io.stdout(
    'restore: if the core service was running, restart it — a writer opened before the restore holds the old file.',
  );
  return 0;
}
