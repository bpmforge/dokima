import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openEventLog, openEventLogReader, type EventLog } from '@dokima/events';
import { computeDokimaHome } from '@dokima/shared';
import { computeFleetRegistryPath } from '../api/projects/registry-store.js';
import { resolveProjectRecord } from '../api/server/board-project.js';

/** Project-local state per DATABASE.md §5 — gitignored, travels with the repo dir. */
export const PROJECT_STATE_DIR = '.dokima';
export const PROJECT_STATE_FILE = 'state.db';

export function resolveDbPath(cwd: string, override?: string): string {
  if (override) return path.resolve(cwd, override);
  return path.join(cwd, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
}

export class UnknownProjectError extends Error {
  constructor(public readonly projectId: string) {
    super(
      `no project registered with id ${projectId} — run \`dokima\` and open the Fleet to see the ids you have`,
    );
    this.name = 'UnknownProjectError';
  }
}

/**
 * W10-74: addresses a project the way the founder can actually name it.
 *
 * `resolveDbPath`'s two existing modes both assume you already know where the
 * project lives on disk — `--db <path>`, or the cwd you happen to be standing
 * in. Someone who created a product through the Fleet has neither: they have
 * the id on the card, and no reason to know that its event log sits at
 * `<projectPath>/.dokima/state.db`. That gap is why the lifecycle verbs were
 * reachable-but-unusable even once the packaging was fixed.
 *
 * `--db` still wins when both are given: it is the explicit escape hatch, and
 * a caller who names a file means that file.
 */
export async function resolveDbPathForProject(
  cwd: string,
  opts: { db?: string; projectId?: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
  if (opts.db) return path.resolve(cwd, opts.db);
  if (!opts.projectId) return resolveDbPath(cwd);
  const registryPath = computeFleetRegistryPath(computeDokimaHome(opts.env));
  const record = await resolveProjectRecord(registryPath, opts.projectId);
  if (!record) throw new UnknownProjectError(opts.projectId);
  return path.join(record.path, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
}

/**
 * Opens the writable log for board/verb commands. Creates the `.dokima/`
 * directory on first use (better-sqlite3 does not create parent dirs) — verb
 * commands are the CLI's own single writer for the duration of the call
 * (C6); the connection closes before the process exits.
 */
/**
 * A path that cannot be opened is a refusal, not a crash (W21-99).
 *
 * `dokima board --db /nonexistent.db` printed "SqliteError: unable to open
 * database file" and a stack trace through better-sqlite3 and dist/main.js. A
 * person who mistypes a path gets told the product broke.
 *
 * THIRD INSTANCE OF ONE CLASS. W21-81 was a LaneScopeError escaping
 * reportVerbError; W21-91 a native parseArgs TypeError escaping runCli; this a
 * SqliteError doing the same. Each time a handler recognised only its own
 * error class and everything else reached the top-level catch that prints
 * `err.stack`. `verify-chain` already had the right shape — "cannot open event
 * log at <path>" — it was simply never applied to the other verbs.
 */
export class DbOpenError extends Error {
  constructor(
    public readonly dbPath: string,
    cause: unknown,
  ) {
    super(`cannot open the event log at ${dbPath} (${(cause as Error).message})`);
    this.name = 'DbOpenError';
    this.cause = cause;
  }
}

export function openWritableLog(dbPath: string): EventLog {
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return openEventLog(dbPath);
  } catch (err) {
    throw new DbOpenError(dbPath, err);
  }
}

/** Read-only connection for `verify-chain` — refuses to conjure a log that doesn't exist yet. */
export function openReadOnlyLog(dbPath: string): EventLog {
  try {
    const db = openEventLogReader(dbPath);
    return { db, path: dbPath, close: () => db.close() };
  } catch (err) {
    throw new DbOpenError(dbPath, err);
  }
}
