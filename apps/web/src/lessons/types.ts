export type FieldReportSource = 'trace' | 'escalation' | 'manual';

export type FieldReportStatus =
  'pending' | 'accepted_playbook' | 'accepted_ticket' | 'rejected';

/** `GET/POST /projects/{id}/field-reports` row shape (BLUEPRINT §12.6, W7-05). */
export interface FieldReportRecord {
  id: number;
  ticketId: string | null;
  source: FieldReportSource;
  sourceRef: string | null;
  whatHappened: string;
  expected: string;
  evidenceLinks: string[];
  filedBy: string;
  filedAt: string;
  status: FieldReportStatus;
  triagedBy: string | null;
  triagedAt: string | null;
  triageNote: string | null;
  resultingPlaybookEntryId: number | null;
  resultingTicketId: string | null;
}

/** A field report before it's filed — the form's controlled state, pre-filled from a trace or escalation event (UX_SPEC §7 G-10c). */
export interface FieldReportDraft {
  ticketId: string | null;
  source: FieldReportSource;
  sourceRef: string | null;
  whatHappened: string;
  expected: string;
  evidenceLinks: string[];
}

export const BLANK_DRAFT: FieldReportDraft = {
  ticketId: null,
  source: 'manual',
  sourceRef: null,
  whatHappened: '',
  expected: '',
  evidenceLinks: [],
};
