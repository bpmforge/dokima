/**
 * `dokima backup` (DEPLOYMENT.md §4/§8): SQLite online backup
 * (`VACUUM INTO`) of the current project's `state.db` into
 * `.dokima/backups/`, then prunes to the retention count (default 7).
 */

import {
  createOnlineBackup,
  pruneBackups,
  DEFAULT_RETENTION_COUNT,
} from '@dokima/events';
import { resolveProjectPaths } from '../../bootstrap/config.js';
import type { CliIO } from '../../bootstrap/cli.js';

export interface BackupCommandDeps {
  createOnlineBackup?: typeof createOnlineBackup;
  pruneBackups?: typeof pruneBackups;
  retentionCount?: number;
}

export async function runBackupCommand(
  io: CliIO,
  deps: BackupCommandDeps = {},
): Promise<number> {
  const createOnlineBackupImpl = deps.createOnlineBackup ?? createOnlineBackup;
  const pruneBackupsImpl = deps.pruneBackups ?? pruneBackups;
  const retentionCount = deps.retentionCount ?? DEFAULT_RETENTION_COUNT;
  const paths = resolveProjectPaths(io.cwd);

  let backupPath: string;
  try {
    backupPath = await createOnlineBackupImpl(paths.dbPath, paths.backupsDir, {
      now: io.now,
    });
  } catch (err) {
    io.stderr(
      `backup refused: cannot back up ${paths.dbPath} (${(err as Error).message})`,
    );
    return 1;
  }

  const { kept, pruned } = await pruneBackupsImpl(paths.backupsDir, retentionCount);
  io.stdout(`backup: wrote ${backupPath}`);
  io.stdout(
    `backup: retention ${retentionCount} — kept ${kept.length}, pruned ${pruned.length}`,
  );
  return 0;
}
