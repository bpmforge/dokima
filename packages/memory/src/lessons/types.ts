/**
 * Field-report intake types (BLUEPRINT §12.6, W7-05 G-10c): a structured
 * report a user or the trace viewer files when a run goes sideways.
 */

export type FieldReportSource = 'trace' | 'escalation' | 'manual';

export type FieldReportStatus =
  'pending' | 'accepted_playbook' | 'accepted_ticket' | 'rejected';

export interface FieldReportRecord {
  readonly id: number;
  readonly ticketId: string | null;
  readonly source: FieldReportSource;
  readonly sourceRef: string | null;
  readonly whatHappened: string;
  readonly expected: string;
  readonly evidenceLinks: readonly string[];
  readonly filedBy: string;
  readonly filedAt: string;
  readonly status: FieldReportStatus;
  readonly triagedBy: string | null;
  readonly triagedAt: string | null;
  readonly triageNote: string | null;
  readonly resultingPlaybookEntryId: number | null;
  readonly resultingTicketId: string | null;
}
