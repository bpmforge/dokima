/**
 * Shared types for `resume.ts` (FR-H3). Split per CODE_BOOK_PROTOCOL.md.
 */

import type { EventLog, ReceiptRecord } from '@dokima/events';
import type { Ticket } from '@dokima/tickets';

export interface CheckClaimedTicketOptions {
  /** Root a ticket's worktree lives under: `<repoRoot>/.dokima/worktrees/<ticketId>` (loop-claim.ts's own convention). */
  readonly repoRoot: string;
  /** Same keychain-resolved minting secret `verifyReceipt` needs (FR-S2) — never redone, only re-verified. */
  readonly signingKey: string;
  readonly requiredValidators?: readonly string[];
}

export type ClaimedTicketCheck =
  | { readonly outcome: 'no-receipt'; readonly ticketId: string }
  | {
      readonly outcome: 'valid';
      readonly ticketId: string;
      readonly ticket: Ticket;
      readonly receipt: ReceiptRecord;
    }
  | {
      readonly outcome: 'drift';
      readonly ticketId: string;
      readonly reasons: readonly string[];
    };

export interface ResumeDriftEntry {
  readonly ticketId: string;
  readonly reasons: readonly string[];
}

export interface ResumeProjectSuccess {
  readonly ok: true;
  /** Tickets folded to `in_review` by phase 2 (had a valid, unresumed close receipt). */
  readonly closed: readonly Ticket[];
  /** Claimed-but-unclosed tickets with no receipt at all — left untouched (UC-11 "ticket B"), a fresh session picks them up. */
  readonly skipped: readonly string[];
}

export interface ResumeProjectRefusal {
  readonly ok: false;
  /** Non-empty; one entry per drifted ticket. Zero events were appended for this call (see resume.ts doc). */
  readonly driftReport: readonly ResumeDriftEntry[];
}

export type ResumeProjectResult = ResumeProjectSuccess | ResumeProjectRefusal;

export interface ResumeProjectOptions extends CheckClaimedTicketOptions {
  readonly log: EventLog;
  readonly now?: () => string;
}
