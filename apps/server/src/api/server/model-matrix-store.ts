/**
 * model_matrix persistence (DATABASE.md §6, AC5): the project-scope override
 * of the global preset.
 *
 * W10-64 builds the global preset that sentence has always described. Until
 * now only the override existed: rows lived in the project `state.db` and
 * nowhere else, so `resolveModelTarget` short-circuited to the env target for
 * every new product (`rows.length === 0`, model-resolution.ts) and "register
 * once, use everywhere" (FR-F3, and `global-db/providers.ts` says it verbatim)
 * was false for the model even after W10-62 made it true for the provider.
 *
 * The global rows live in `~/.dokima/config.json` under a `model_matrix` key
 * — the same file and the same mechanism `providers` already uses, so there is
 * one global-settings story rather than two. They are deliberately NOT a
 * second SQLite table: a global DB would need its own migration, its own
 * single-writer discipline (C-6), and would give the CLI a third place to
 * disagree with the GUI about configuration.
 *
 * Precedence is project-then-global and nothing else (FR-S1). A project with
 * ANY rows of its own ignores the global preset entirely rather than merging
 * row-by-row: a half-merged matrix, where a role you never configured here
 * silently inherits from elsewhere, is far harder to reason about than a
 * clean override — and `appendModelMatrixChanged`'s before/after diff would
 * report phantom changes for rows the project never had.
 */

import { getGlobalSettings, putGlobalSetting } from './settings-scope.js';
import { withSettingsReader, withSettingsWriter } from './settings-db.js';
import type { ModelMatrixRow, TaskType } from './settings-types.js';

interface ModelMatrixSqlRow {
  role: string;
  task_type: string;
  model: string;
  fallback: string;
  updated_at: string;
}

function fromSqlRow(row: ModelMatrixSqlRow): ModelMatrixRow {
  return {
    role: row.role,
    taskType: row.task_type as TaskType,
    model: row.model,
    fallback: JSON.parse(row.fallback) as string[],
    updatedAt: row.updated_at,
  };
}

const SELECT_ALL =
  'SELECT role, task_type, model, fallback, updated_at FROM model_matrix ORDER BY role, task_type';

export const GLOBAL_MATRIX_SETTINGS_KEY = 'model_matrix';

/** The project's OWN rows, ignoring any global preset — what the PUT route diffs against. */
export async function listProjectModelMatrix(
  projectPath: string,
): Promise<ModelMatrixRow[]> {
  return withSettingsReader(projectPath, [], (db) => {
    const rows = db.prepare(SELECT_ALL).all() as ModelMatrixSqlRow[];
    return rows.map(fromSqlRow);
  });
}

function isMatrixRow(value: unknown): value is ModelMatrixRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.role === 'string' &&
    typeof row.taskType === 'string' &&
    typeof row.model === 'string' &&
    Array.isArray(row.fallback) &&
    row.fallback.every((f) => typeof f === 'string')
  );
}

/**
 * The global preset. A malformed stored value degrades to an empty matrix
 * rather than throwing — same discipline as `listProviders`: an unreadable
 * setting must not take the whole settings surface down, and "nothing
 * configured globally" is the normal state (C-1), never an error.
 */
export async function listGlobalModelMatrix(): Promise<ModelMatrixRow[]> {
  const raw: unknown = (await getGlobalSettings())[GLOBAL_MATRIX_SETTINGS_KEY];
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter(isMatrixRow);
  // All-or-nothing: a partially valid stored matrix is a corrupt one, and
  // silently running on the half that parsed is how a config problem becomes
  // a wrong-model problem nobody notices.
  return rows.length === raw.length ? rows : [];
}

/** Replaces the global preset wholesale. */
export async function putGlobalModelMatrix(
  rows: readonly ModelMatrixInput[],
  now: () => string = () => new Date().toISOString(),
  loggingProjectPath?: string,
): Promise<ModelMatrixRow[]> {
  const updatedAt = now();
  const stored: ModelMatrixRow[] = rows.map((r) => ({
    role: r.role,
    taskType: r.taskType,
    model: r.model,
    fallback: [...r.fallback],
    updatedAt,
  }));
  await putGlobalSetting(
    GLOBAL_MATRIX_SETTINGS_KEY,
    stored as unknown as Parameters<typeof putGlobalSetting>[1],
    loggingProjectPath,
  );
  return stored;
}

/**
 * THE RESOLUTION EVERY CALLER GETS: the project's rows, or the global preset
 * when the project has none. `resolveModelTarget` reads this, so a model
 * configured once now applies to a product created afterwards.
 */
export async function listModelMatrix(projectPath: string): Promise<ModelMatrixRow[]> {
  const own = await listProjectModelMatrix(projectPath);
  if (own.length > 0) return own;
  return listGlobalModelMatrix();
}

export interface ModelMatrixInput {
  readonly role: string;
  readonly taskType: TaskType;
  readonly model: string;
  readonly fallback: readonly string[];
}

/** Upserts every given row (PK role+task_type), then returns the full matrix. */
export async function putModelMatrix(
  projectPath: string,
  rows: readonly ModelMatrixInput[],
  now: () => string = () => new Date().toISOString(),
): Promise<ModelMatrixRow[]> {
  return withSettingsWriter(projectPath, (db) => {
    const nowIso = now();
    const upsert = db.prepare(
      `INSERT INTO model_matrix (role, task_type, model, fallback, updated_at)
       VALUES (@role, @taskType, @model, @fallback, @updatedAt)
       ON CONFLICT(role, task_type) DO UPDATE SET
         model = excluded.model, fallback = excluded.fallback, updated_at = excluded.updated_at`,
    );
    for (const row of rows) {
      upsert.run({
        role: row.role,
        taskType: row.taskType,
        model: row.model,
        fallback: JSON.stringify(row.fallback),
        updatedAt: nowIso,
      });
    }
    const all = db.prepare(SELECT_ALL).all() as ModelMatrixSqlRow[];
    return all.map(fromSqlRow);
  });
}
