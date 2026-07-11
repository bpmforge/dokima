/** Ticket contract fields per docs/DATABASE.md §3 `tickets` projection. */
export type TicketType = 'epic' | 'story' | 'task' | 'bug';

/**
 * `blocked` and `waived` are valid resting states but are not reached via the
 * six lifecycle verbs in this package — `blocked` is a reflow concern
 * (W0-04: deps-unmet auto-resolve) and `waived` belongs to the gate/waiver
 * layer. The verb transition graph below only ever produces the other five.
 */
export type TicketStatus =
  'ready' | 'claimed' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'waived';

export interface AcceptanceCriterion {
  id: string;
  text: string;
  done: boolean;
}

export interface VerifyResult {
  command: string;
  exitCode: number;
}

/**
 * Minted by `close` and embedded verbatim in the manifest (DATABASE.md §3
 * `manifest.receipt_id`). Self-contained for W0-03 — W0-05 introduces the
 * durable, hash-anchored `receipts` table; a later ticket wires this into
 * that primitive without changing the shape consumers rely on here.
 */
export interface CloseReceipt {
  ticketId: string;
  ownerId: string;
  verify: VerifyResult;
  commits: string[];
  files: string[];
  mintedAt: string;
}

export interface TicketManifest {
  files: string[];
  verify: VerifyResult;
  commits: string[];
  closeReceipt: CloseReceipt;
}

export interface TicketHistoryEntry {
  verb: 'claim' | 'start' | 'close' | 'accept' | 'release' | 'comment';
  actorId: string;
  at: string;
}

export interface TicketCommentEvidence {
  actorId: string;
  body: string;
  at: string;
}

export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  lane: string;
  ownerId: string | null;
  status: TicketStatus;
  interface: string | null;
  writeScope: string[];
  dependsOn: string[];
  acceptance: AcceptanceCriterion[];
  verify: string | null;
  manifest: TicketManifest | null;
  history: TicketHistoryEntry[];
  evidence: TicketCommentEvidence[];
  claimedAt: string | null;
  closedAt: string | null;
}

export interface CreateTicketInput {
  id: string;
  type: TicketType;
  title: string;
  lane: string;
  interface?: string | null;
  writeScope: string[];
  dependsOn?: string[];
  acceptance?: AcceptanceCriterion[];
  verify?: string | null;
}
