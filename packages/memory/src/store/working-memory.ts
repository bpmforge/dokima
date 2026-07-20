/**
 * Working memory: per-project, always-on findings for the current run
 * (BLUEPRINT §3.8, DATABASE.md §5 `working_findings`). Mutable in place
 * (resolved flips 0->1), not append-only — the audit trail for these lives
 * in the event log, this table is a live scratchpad.
 */
import type { SqliteHandle } from './handle.js';

export interface WorkingFinding {
  readonly id: number;
  readonly ticketId: string | null;
  readonly runId: string | null;
  readonly summary: string;
  readonly detail: string | null;
  readonly confirmedBy: string | null;
  readonly createdAt: string;
  readonly resolved: boolean;
}

export interface InsertWorkingFindingInput {
  readonly ticketId?: string | null;
  readonly runId?: string | null;
  readonly summary: string;
  readonly detail?: string | null;
  readonly confirmedBy?: string | null;
}

interface WorkingFindingRow {
  id: number;
  ticket_id: string | null;
  run_id: string | null;
  summary: string;
  detail: string | null;
  confirmed_by: string | null;
  created_at: string;
  resolved: number;
}

function toRecord(row: WorkingFindingRow): WorkingFinding {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    runId: row.run_id,
    summary: row.summary,
    detail: row.detail,
    confirmedBy: row.confirmed_by,
    createdAt: row.created_at,
    resolved: row.resolved === 1,
  };
}

export function insertWorkingFinding(
  handle: SqliteHandle,
  input: InsertWorkingFindingInput,
  now: () => string,
): WorkingFinding {
  const result = handle
    .prepare(
      `INSERT INTO working_findings (ticket_id, run_id, summary, detail, confirmed_by, created_at, resolved)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      input.ticketId ?? null,
      input.runId ?? null,
      input.summary,
      input.detail ?? null,
      input.confirmedBy ?? null,
      now(),
    );
  const row = handle
    .prepare<WorkingFindingRow>('SELECT * FROM working_findings WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  return toRecord(row as WorkingFindingRow);
}

export function resolveWorkingFinding(handle: SqliteHandle, id: number): void {
  handle.prepare('UPDATE working_findings SET resolved = 1 WHERE id = ?').run(id);
}

export interface ListWorkingFindingsFilter {
  readonly runId?: string;
  readonly ticketId?: string;
  readonly unresolvedOnly?: boolean;
}

export function listWorkingFindings(
  handle: SqliteHandle,
  filter: ListWorkingFindingsFilter = {},
): WorkingFinding[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.runId) {
    clauses.push('run_id = ?');
    params.push(filter.runId);
  }
  if (filter.ticketId) {
    clauses.push('ticket_id = ?');
    params.push(filter.ticketId);
  }
  if (filter.unresolvedOnly) {
    clauses.push('resolved = 0');
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = handle
    .prepare<WorkingFindingRow>(`SELECT * FROM working_findings ${where} ORDER BY id`)
    .all(...params);
  return rows.map(toRecord);
}
