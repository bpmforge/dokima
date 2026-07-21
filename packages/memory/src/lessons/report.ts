/**
 * Field-report intake (BLUEPRINT §12.6): files a structured report —
 * untrusted by construction, any actor may file. Confirmation happens only
 * at triage (`triage.ts`), never here — filing alone never produces a
 * playbook entry or a ticket.
 */
import type { SqliteHandle } from '../store/handle.js';
import { noopLessonsEventSink, type LessonsEventSink } from './events.js';
import type { FieldReportRecord, FieldReportSource, FieldReportStatus } from './types.js';

export interface FileFieldReportInput {
  readonly ticketId?: string | null;
  readonly source: FieldReportSource;
  readonly sourceRef?: string | null;
  readonly whatHappened: string;
  readonly expected: string;
  readonly evidenceLinks?: readonly string[];
  readonly filedBy: string;
}

/** Thrown when a required narrative field or the filer identity is blank — a field report with nothing to triage is not a report. */
export class IncompleteFieldReportError extends Error {
  constructor(public readonly field: string) {
    super(`field report requires a non-blank "${field}"`);
    this.name = 'IncompleteFieldReportError';
  }
}

interface FieldReportRow {
  id: number;
  ticket_id: string | null;
  source: string;
  source_ref: string | null;
  what_happened: string;
  expected: string;
  evidence_links: string;
  filed_by: string;
  filed_at: string;
  status: string;
  triaged_by: string | null;
  triaged_at: string | null;
  triage_note: string | null;
  resulting_playbook_entry_id: number | null;
  resulting_ticket_id: string | null;
}

function toRecord(row: FieldReportRow): FieldReportRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    source: row.source as FieldReportSource,
    sourceRef: row.source_ref,
    whatHappened: row.what_happened,
    expected: row.expected,
    evidenceLinks: JSON.parse(row.evidence_links) as string[],
    filedBy: row.filed_by,
    filedAt: row.filed_at,
    status: row.status as FieldReportStatus,
    triagedBy: row.triaged_by,
    triagedAt: row.triaged_at,
    triageNote: row.triage_note,
    resultingPlaybookEntryId: row.resulting_playbook_entry_id,
    resultingTicketId: row.resulting_ticket_id,
  };
}

function assertNonBlank(value: string, field: string): void {
  if (!value || value.trim() === '') {
    throw new IncompleteFieldReportError(field);
  }
}

export interface FileFieldReportOptions {
  readonly sink?: LessonsEventSink;
}

/** Stores an untriaged field report and emits `lessons.filed`. Never confirms anything by itself — status is always `pending`. */
export function fileFieldReport(
  handle: SqliteHandle,
  input: FileFieldReportInput,
  now: () => string,
  options: FileFieldReportOptions = {},
): FieldReportRecord {
  assertNonBlank(input.whatHappened, 'whatHappened');
  assertNonBlank(input.expected, 'expected');
  assertNonBlank(input.filedBy, 'filedBy');
  const sink = options.sink ?? noopLessonsEventSink;
  const filedAt = now();
  const evidenceLinks = JSON.stringify(input.evidenceLinks ?? []);

  const result = handle
    .prepare(
      `INSERT INTO field_reports
         (ticket_id, source, source_ref, what_happened, expected, evidence_links, filed_by, filed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      input.ticketId ?? null,
      input.source,
      input.sourceRef ?? null,
      input.whatHappened,
      input.expected,
      evidenceLinks,
      input.filedBy,
      filedAt,
    );

  const record = getFieldReport(
    handle,
    Number(result.lastInsertRowid),
  ) as FieldReportRecord;
  void sink.emit({
    type: 'lessons.filed',
    reportId: record.id,
    actorId: input.filedBy,
    occurredAt: filedAt,
  });
  return record;
}

export function getFieldReport(
  handle: SqliteHandle,
  id: number,
): FieldReportRecord | undefined {
  const row = handle
    .prepare<FieldReportRow>('SELECT * FROM field_reports WHERE id = ?')
    .get(id);
  return row ? toRecord(row) : undefined;
}

export interface ListFieldReportsOptions {
  readonly status?: FieldReportStatus;
}

/** Newest-first, optionally scoped to a status — the triage queue's read path. */
export function listFieldReports(
  handle: SqliteHandle,
  options: ListFieldReportsOptions = {},
): FieldReportRecord[] {
  const rows = options.status
    ? handle
        .prepare<FieldReportRow>(
          'SELECT * FROM field_reports WHERE status = ? ORDER BY filed_at DESC',
        )
        .all(options.status)
    : handle
        .prepare<FieldReportRow>('SELECT * FROM field_reports ORDER BY filed_at DESC')
        .all();
  return rows.map(toRecord);
}
