/**
 * Project resolution + raw SQLite plumbing shared by the settings stores
 * that DATABASE.md places in the project DB rather than a settings file
 * (model_matrix §6; rule_state/suppressions §5b). Schema lives in
 * `packages/events/migrations/003_settings.sql`; `openEventLog` applies it
 * (like every other migration) the moment this module opens a writable
 * connection, so these tables exist by the time any settings write runs.
 *
 * Mutations open a short-lived writable connection (`openEventLog`, closed
 * immediately after the transaction) rather than holding one open —
 * mirrors `projects.ts`'s `ensureStateDb`, and stays in step with C6's
 * single-writer law (the project's own daemon, when running, is the
 * long-lived writer; this is a brief, self-closing second connection for
 * an operator-driven settings edit, safe under WAL + better-sqlite3's
 * synchronous, single-threaded execution).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openEventLog, openEventLogReader } from '@shipwright/events';
import { computeShipwrightHome } from '@shipwright/shared';

const STATE_DB_RELATIVE = path.join('.shipwright', 'state.db');
const FLEET_REGISTRY_FILENAME = 'fleet.json';

export class ProjectNotFoundError extends Error {}

interface FleetRecordShape {
  id: string;
  path: string;
}

/** Resolves a project id to its directory via the Fleet registry (same file `apps/server/src/api/projects.ts` reads/writes). */
export async function resolveProjectPath(id: string, home?: string): Promise<string> {
  const registryPath = path.join(
    home ?? computeShipwrightHome(),
    FLEET_REGISTRY_FILENAME,
  );
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectNotFoundError(`no project registered with id "${id}"`);
    }
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  const records = Array.isArray(parsed) ? (parsed as FleetRecordShape[]) : [];
  const record = records.find((r) => r.id === id);
  if (!record) throw new ProjectNotFoundError(`no project registered with id "${id}"`);
  return record.path;
}

export function stateDbPath(projectPath: string): string {
  return path.join(projectPath, STATE_DB_RELATIVE);
}

/** Mirrors `apps/server/src/api/projects.ts`'s `isUnmigratedSchemaError` — a `state.db` on an older migration version has none of these tables yet, which is not a real failure (degrades to caller-supplied fallback, e.g. an unmigrated project opened read-only before ever taking a settings write). */
export function isMissingTableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'SQLITE_ERROR' &&
    /no such table/.test(err.message)
  );
}

/** Read-only: returns `fallback` rather than creating tables — never contends with a live writer (C6). */
export async function withSettingsReader<T>(
  projectPath: string,
  fallback: T,
  fn: (db: ReturnType<typeof openEventLogReader>) => T,
): Promise<T> {
  const dbPath = stateDbPath(projectPath);
  let db: ReturnType<typeof openEventLogReader>;
  try {
    db = openEventLogReader(dbPath);
  } catch {
    return fallback;
  }
  try {
    return fn(db);
  } catch (err) {
    if (isMissingTableError(err)) return fallback;
    throw err;
  } finally {
    db.close();
  }
}

/** Writable: opens briefly (applying any pending migration), runs `fn` in a transaction, closes immediately. */
export async function withSettingsWriter<T>(
  projectPath: string,
  fn: (db: ReturnType<typeof openEventLog>['db']) => T,
): Promise<T> {
  const dbPath = stateDbPath(projectPath);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const log = openEventLog(dbPath);
  try {
    return log.db.transaction(fn)(log.db);
  } finally {
    log.close();
  }
}
