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
export function openWritableLog(dbPath: string): EventLog {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return openEventLog(dbPath);
}

/** Read-only connection for `verify-chain` — refuses to conjure a log that doesn't exist yet. */
export function openReadOnlyLog(dbPath: string): EventLog {
  const db = openEventLogReader(dbPath);
  return { db, path: dbPath, close: () => db.close() };
}
