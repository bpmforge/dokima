/** model_matrix persistence (DATABASE.md §6, AC5): the project-scope override of the global preset. */

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

export async function listModelMatrix(projectPath: string): Promise<ModelMatrixRow[]> {
  return withSettingsReader(projectPath, [], (db) => {
    const rows = db.prepare(SELECT_ALL).all() as ModelMatrixSqlRow[];
    return rows.map(fromSqlRow);
  });
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
