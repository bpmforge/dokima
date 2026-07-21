/**
 * Triage (BLUEPRINT §12.6: "triaged reports become playbook entries or
 * validator fixes"). Triage IS the confirmation step FR-M2 requires — a
 * field report is filed by an untrusted actor (a user or the trace viewer),
 * never itself a tool/challenger outcome, so accepting straight into the
 * playbook would smuggle an unconfirmed lesson past `insertPlaybookEntry`'s
 * guard. Every triage function here requires `triagedBy !== report.filedBy`
 * (maker != verifier, Law 5/C-4: the filer cannot confirm their own report)
 * and treats the triager as the challenger identity, so an accepted-to-
 * playbook report legitimately carries `verifiedBy: 'challenger'`.
 *
 * The validator-fix-ticket path never creates a real ticket — this package
 * can't depend on `@shipwright/tickets` (ARCHITECTURE §4) — it only
 * *prepares* the exact `CreateTicketInput` shape
 * `packages/tickets/src/types.ts` expects; `triage-ticket.test.ts` proves the
 * structural match by dynamically importing the real `createTicket`.
 */
import { insertPlaybookEntry, type PlaybookEntryRecord } from '../playbook/playbook.js';
import type { SqliteHandle } from '../store/handle.js';
import { noopLessonsEventSink, type LessonsEventSink } from './events.js';
import { getFieldReport } from './report.js';
import type { FieldReportRecord } from './types.js';

export class FieldReportNotFoundError extends Error {
  constructor(public readonly reportId: number) {
    super(`no field report with id ${reportId} to triage`);
    this.name = 'FieldReportNotFoundError';
  }
}

/** A report that was filed and triaged by the same actor confirms nothing — thrown for every triage path (accept-to-playbook, accept-to-ticket, reject). */
export class SelfTriageError extends Error {
  constructor() {
    super(
      'triage requires an actor distinct from the report filer — a filer cannot confirm their own report (Law 5, C-4)',
    );
    this.name = 'SelfTriageError';
  }
}

export class FieldReportAlreadyTriagedError extends Error {
  constructor(
    public readonly reportId: number,
    public readonly status: string,
  ) {
    super(`field report ${reportId} was already triaged (status=${status})`);
    this.name = 'FieldReportAlreadyTriagedError';
  }
}

function loadPendingReport(
  handle: SqliteHandle,
  reportId: number,
  triagedBy: string,
): FieldReportRecord {
  const report = getFieldReport(handle, reportId);
  if (!report) {
    throw new FieldReportNotFoundError(reportId);
  }
  if (report.status !== 'pending') {
    throw new FieldReportAlreadyTriagedError(reportId, report.status);
  }
  if (report.filedBy === triagedBy) {
    throw new SelfTriageError();
  }
  return report;
}

interface TriageOptions {
  readonly sink?: LessonsEventSink;
}

export interface TriageToPlaybookInput {
  readonly reportId: number;
  readonly triagedBy: string;
  readonly taskClass: string;
  readonly entry: string;
  readonly triageNote?: string;
}

export interface TriageToPlaybookResult {
  readonly report: FieldReportRecord;
  readonly playbookEntry: PlaybookEntryRecord;
}

/** Accepts a report as a confirmed lesson: inserts a `verifiedBy: 'challenger'` playbook entry (the triage itself is the confirmation) and marks the report `accepted_playbook`. */
export function triageToPlaybookEntry(
  handle: SqliteHandle,
  input: TriageToPlaybookInput,
  now: () => string,
  options: TriageOptions = {},
): TriageToPlaybookResult {
  const sink = options.sink ?? noopLessonsEventSink;
  loadPendingReport(handle, input.reportId, input.triagedBy);

  const playbookEntry = insertPlaybookEntry(
    handle,
    { taskClass: input.taskClass, entry: input.entry, verifiedBy: 'challenger' },
    now,
  );

  const triagedAt = now();
  handle
    .prepare(
      `UPDATE field_reports
         SET status = 'accepted_playbook', triaged_by = ?, triaged_at = ?, triage_note = ?, resulting_playbook_entry_id = ?
       WHERE id = ?`,
    )
    .run(
      input.triagedBy,
      triagedAt,
      input.triageNote ?? null,
      playbookEntry.id,
      input.reportId,
    );

  const report = getFieldReport(handle, input.reportId) as FieldReportRecord;
  void sink.emit({
    type: 'lessons.triaged',
    reportId: input.reportId,
    actorId: input.triagedBy,
    outcome: 'accepted_playbook',
    occurredAt: triagedAt,
  });
  return { report, playbookEntry };
}

/** The exact shape `@shipwright/tickets`' `createTicket` (`CreateTicketInput`, `packages/tickets/src/types.ts`) expects, reproduced rather than imported. */
export interface ValidatorFixTicketPayload {
  readonly id: string;
  readonly type: 'bug';
  readonly title: string;
  readonly lane: string;
  readonly writeScope: string[];
  readonly dependsOn: string[];
  readonly acceptance: string[];
  readonly verify: string | null;
}

export interface PrepareValidatorFixTicketInput {
  readonly reportId: number;
  readonly triagedBy: string;
  readonly ticketId: string;
  readonly title: string;
  readonly lane: string;
  readonly writeScope: string[];
  readonly acceptance?: string[];
  readonly verify?: string | null;
  readonly triageNote?: string;
}

export interface PrepareValidatorFixTicketResult {
  readonly report: FieldReportRecord;
  readonly payload: ValidatorFixTicketPayload;
}

/**
 * Accepts a report as a validator-fix bug: marks the report
 * `accepted_ticket` and prepares (never creates — Law 4, tickets go through
 * the real verbs elsewhere) the payload for a `bug`-type ticket.
 */
export function prepareValidatorFixTicket(
  handle: SqliteHandle,
  input: PrepareValidatorFixTicketInput,
  now: () => string,
  options: TriageOptions = {},
): PrepareValidatorFixTicketResult {
  const sink = options.sink ?? noopLessonsEventSink;
  const report = loadPendingReport(handle, input.reportId, input.triagedBy);

  const triagedAt = now();
  handle
    .prepare(
      `UPDATE field_reports
         SET status = 'accepted_ticket', triaged_by = ?, triaged_at = ?, triage_note = ?, resulting_ticket_id = ?
       WHERE id = ?`,
    )
    .run(
      input.triagedBy,
      triagedAt,
      input.triageNote ?? null,
      input.ticketId,
      input.reportId,
    );

  const updated = getFieldReport(handle, input.reportId) as FieldReportRecord;
  void sink.emit({
    type: 'lessons.triaged',
    reportId: input.reportId,
    actorId: input.triagedBy,
    outcome: 'accepted_ticket',
    occurredAt: triagedAt,
  });

  const payload: ValidatorFixTicketPayload = {
    id: input.ticketId,
    type: 'bug',
    title: input.title,
    lane: input.lane,
    writeScope: input.writeScope,
    dependsOn: [],
    acceptance: input.acceptance ?? [
      `Fixes the defect reported in field report #${report.id}: ${report.whatHappened}`,
    ],
    verify: input.verify ?? null,
  };
  return { report: updated, payload };
}

export interface RejectFieldReportInput {
  readonly reportId: number;
  readonly triagedBy: string;
  readonly triageNote?: string;
}

/** Rejects a report — no playbook entry, no ticket. Still requires a distinct triager, same as an accept (Law 5): rejection is a review judgment too. */
export function rejectFieldReport(
  handle: SqliteHandle,
  input: RejectFieldReportInput,
  now: () => string,
  options: TriageOptions = {},
): FieldReportRecord {
  const sink = options.sink ?? noopLessonsEventSink;
  loadPendingReport(handle, input.reportId, input.triagedBy);

  const triagedAt = now();
  handle
    .prepare(
      `UPDATE field_reports
         SET status = 'rejected', triaged_by = ?, triaged_at = ?, triage_note = ?
       WHERE id = ?`,
    )
    .run(input.triagedBy, triagedAt, input.triageNote ?? null, input.reportId);

  const report = getFieldReport(handle, input.reportId) as FieldReportRecord;
  void sink.emit({
    type: 'lessons.triaged',
    reportId: input.reportId,
    actorId: input.triagedBy,
    outcome: 'rejected',
    occurredAt: triagedAt,
  });
  return report;
}
