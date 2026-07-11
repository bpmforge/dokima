/**
 * Reason codes for refused verbs (FR-T4 "explain this refusal" — a human
 * drag or an agent call gets the same specific rule back, never a bare 409).
 */
export type TicketErrorCode =
  | 'TICKET_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'WIP_LIMIT'
  | 'NOT_OWNER'
  | 'SELF_ACCEPT'
  | 'MANIFEST_INVALID'
  | 'MISSING_CLOSE_RECEIPT';

export class TicketError extends Error {
  readonly code: TicketErrorCode;
  readonly ticketId: string;

  constructor(code: TicketErrorCode, ticketId: string, message: string) {
    super(message);
    this.name = 'TicketError';
    this.code = code;
    this.ticketId = ticketId;
  }
}
