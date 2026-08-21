import type { GlobalDb } from './db.js';

export interface ProjectRecord {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly archived: boolean;
  readonly lastOpenedAt: string;
  readonly createdAt: string;
}

export interface RegisterProjectInput {
  readonly id: string;
  readonly path: string;
  readonly name: string;
}



/** Registers a project in the Fleet index (FR-F1/F2) — id/path/name only; card *stats* are never stored here (DATABASE.md §7). */
export function registerProject(
  global: GlobalDb,
  input: RegisterProjectInput,
  now: () => string = () => new Date().toISOString(),
): ProjectRecord {
  const nowIso = now();
  global.db
    .prepare(
      `INSERT INTO projects (id, path, name, archived, last_opened_at, created_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(input.id, input.path, input.name, nowIso, nowIso);
  return {
    id: input.id,
    path: input.path,
    name: input.name,
    archived: false,
    lastOpenedAt: nowIso,
    createdAt: nowIso,
  };
}




