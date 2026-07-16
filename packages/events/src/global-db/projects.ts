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

interface ProjectRow {
  id: string;
  path: string;
  name: string;
  archived: number;
  last_opened_at: string;
  created_at: string;
}

function rowToRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    archived: row.archived === 1,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
  };
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

export function listProjects(global: GlobalDb): ProjectRecord[] {
  const rows = global.db
    .prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY last_opened_at DESC')
    .all();
  return rows.map(rowToRecord);
}

export function getProject(global: GlobalDb, id: string): ProjectRecord | undefined {
  const row = global.db
    .prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?')
    .get(id);
  return row ? rowToRecord(row) : undefined;
}

export function touchProjectLastOpened(
  global: GlobalDb,
  id: string,
  now: () => string = () => new Date().toISOString(),
): void {
  global.db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(now(), id);
}

export function setProjectArchived(
  global: GlobalDb,
  id: string,
  archived: boolean,
): void {
  global.db
    .prepare('UPDATE projects SET archived = ? WHERE id = ?')
    .run(archived ? 1 : 0, id);
}
