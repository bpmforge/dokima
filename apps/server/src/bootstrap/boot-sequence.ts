/**
 * The boot sequence DEPLOYMENT.md §8 names: migrations → orphan sweep →
 * audit fast tail-check. `openEventLog` (packages/events, out of write_scope)
 * already applies migrations internally; everything else here — the
 * downgrade guard + backup that must run *before* it, and the orphan
 * sweep/tail-check/high-water mirror that must run *after* it, in that
 * order and with their results actually reported rather than swallowed —
 * is this module's job.
 */

import {
  createIdentity,
  getIdentity,
  openEventLog,
  sweepOrphans,
  type EventLog,
  type EventRecord,
} from '@shipwright/events';
import {
  auditTailCheck,
  checkAndUpdateHighWater,
  type TailCheckResult,
} from './audit-tail.js';
import { ensureConfigDirs, type ProjectPaths } from './config.js';
import {
  backupBeforeMigrate,
  checkSchemaCompatibility,
  DowngradeRefusedError,
} from './migrate-guard.js';

export const SYSTEM_ACTOR_ID = 'system:boot';

export interface BootReport {
  paths: ProjectPaths;
  backupPath: string | null;
  orphaned: EventRecord[];
  tailCheck: TailCheckResult;
  highWater: { truncated: boolean; recordedSeq: number; currentSeq: number };
}

export class TruncatedLogError extends Error {
  constructor(
    public readonly dbPath: string,
    public readonly recordedSeq: number,
    public readonly currentSeq: number,
  ) {
    super(
      `refusing to boot ${dbPath}: high-water seq mirror recorded ${recordedSeq} events but ` +
        `the log now has only ${currentSeq} — this looks like truncation (a stale backup ` +
        `restored over the live file, or lost writes). Restore the correct state.db or ` +
        `investigate before continuing (DEPLOYMENT.md §8, SC-11).`,
    );
    this.name = 'TruncatedLogError';
  }
}

function ensureSystemIdentity(log: EventLog, now?: () => string): void {
  if (getIdentity(log, SYSTEM_ACTOR_ID)) return;
  createIdentity(
    log,
    { id: SYSTEM_ACTOR_ID, name: 'boot sequence', kind: 'machine' },
    { now },
  );
}

export interface RunBootSequenceOptions {
  projectDir: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  tailSize?: number;
}

/**
 * Runs the full boot sequence and returns the opened log alongside a report
 * of what each step found. Throws `DowngradeRefusedError` (before opening
 * anything) or `TruncatedLogError` (after the tail check) rather than
 * booting past either signal — DEPLOYMENT.md §8: "never a silent degrade."
 */
export async function runBootSequence(
  opts: RunBootSequenceOptions,
): Promise<{ log: EventLog; report: BootReport }> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date().toISOString());

  const { home, project } = await ensureConfigDirs(opts.projectDir, env);

  const compatibility = await checkSchemaCompatibility(project.dbPath);
  if (!compatibility.compatible) {
    throw new DowngradeRefusedError(
      project.dbPath,
      compatibility.dbVersion,
      compatibility.latestVersion,
    );
  }
  const backupPath = await backupBeforeMigrate(
    project.dbPath,
    project.backupsDir,
    compatibility,
    now,
  );

  const log = openEventLog(project.dbPath); // migrations run here (packages/events)

  ensureSystemIdentity(log, now);
  const orphaned = sweepOrphans(log, SYSTEM_ACTOR_ID, { now });

  const tailCheck = auditTailCheck(log, opts.tailSize);

  const highWater = await checkAndUpdateHighWater(log, home.home, project.dbPath, now);
  if (highWater.truncated) {
    log.close();
    throw new TruncatedLogError(
      project.dbPath,
      highWater.recordedSeq,
      highWater.currentSeq,
    );
  }

  return {
    log,
    report: { paths: project, backupPath, orphaned, tailCheck, highWater },
  };
}
