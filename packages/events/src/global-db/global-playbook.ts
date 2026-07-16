import type { GlobalDb } from './db.js';

export interface GlobalPlaybookRecord {
  readonly id: number;
  readonly taskClass: string;
  readonly entry: string;
  readonly version: number;
  readonly verifiedBy: string;
  readonly deltaOf: number | null;
  readonly promotedFromProject: string;
  readonly sourceEntryId: number;
  readonly promotedBy: string;
  readonly promotedAt: string;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

export interface PromoteGlobalPlaybookInput {
  readonly taskClass: string;
  readonly entry: string;
  readonly version: number;
  readonly verifiedBy: string;
  readonly deltaOf?: number | null;
  readonly promotedFromProject: string;
  readonly sourceEntryId: number;
  /** Human or reviewer identity — promotion is never automatic (DATABASE.md §7). */
  readonly promotedBy: string;
}

interface GlobalPlaybookRow {
  id: number;
  task_class: string;
  entry: string;
  version: number;
  verified_by: string;
  delta_of: number | null;
  promoted_from_project: string;
  source_entry_id: number;
  promoted_by: string;
  promoted_at: string;
  created_at: string;
  retired_at: string | null;
}

function rowToRecord(row: GlobalPlaybookRow): GlobalPlaybookRecord {
  return {
    id: row.id,
    taskClass: row.task_class,
    entry: row.entry,
    version: row.version,
    verifiedBy: row.verified_by,
    deltaOf: row.delta_of,
    promotedFromProject: row.promoted_from_project,
    sourceEntryId: row.source_entry_id,
    promotedBy: row.promoted_by,
    promotedAt: row.promoted_at,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
  };
}

/** Promotes a project-scope playbook entry to Fleet scope (FR-F5) — delta-edited, never replaced, same as the source table (DATABASE.md §5). */
export function promoteGlobalPlaybookEntry(
  global: GlobalDb,
  input: PromoteGlobalPlaybookInput,
  now: () => string = () => new Date().toISOString(),
): GlobalPlaybookRecord {
  const nowIso = now();
  const deltaOf = input.deltaOf ?? null;
  const result = global.db
    .prepare(
      `INSERT INTO global_playbook
         (task_class, entry, version, verified_by, delta_of, promoted_from_project,
          source_entry_id, promoted_by, promoted_at, created_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      input.taskClass,
      input.entry,
      input.version,
      input.verifiedBy,
      deltaOf,
      input.promotedFromProject,
      input.sourceEntryId,
      input.promotedBy,
      nowIso,
      nowIso,
    );
  return {
    id: Number(result.lastInsertRowid),
    taskClass: input.taskClass,
    entry: input.entry,
    version: input.version,
    verifiedBy: input.verifiedBy,
    deltaOf,
    promotedFromProject: input.promotedFromProject,
    sourceEntryId: input.sourceEntryId,
    promotedBy: input.promotedBy,
    promotedAt: nowIso,
    createdAt: nowIso,
    retiredAt: null,
  };
}

export function listGlobalPlaybook(global: GlobalDb): GlobalPlaybookRecord[] {
  const rows = global.db
    .prepare<[], GlobalPlaybookRow>(
      'SELECT * FROM global_playbook WHERE retired_at IS NULL ORDER BY task_class, version',
    )
    .all();
  return rows.map(rowToRecord);
}
