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
  /** Comment text (API_DESIGN.md: `POST /tickets/{id}/comment` -> history row). */
  body?: string;
}

export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  lane: string;
  ownerId: string | null;
  status: TicketStatus;
  interface: string | null;
  /**
   * The expert that does this ticket (D-025, W12-06). Absent => `coding-agent`,
   * which is what every ticket resolved to before this field existed.
   *
   * OPTIONAL, not `string | null` like its neighbours: the board carries 208
   * done tickets with no role and the decomposer does not emit one yet, so the
   * absent case is the common case rather than an unset value someone forgot.
   * `?` makes "this ticket says nothing about its expert" the shape of the
   * type instead of a null everyone has to remember to write.
   */
  role?: string;
  writeScope: string[];
  dependsOn: string[];
  acceptance: AcceptanceCriterion[];
  verify: string | null;
  manifest: TicketManifest | null;
  history: TicketHistoryEntry[];
  /** Failure receipts / escalation trail (DATABASE.md §3) — populated by later tickets (loop escalation). */
  evidence: unknown[];
  claimedAt: string | null;
  closedAt: string | null;
}

/** W21-27: the founder answering "this ticket is not right as written". */
export interface WidenTicketScopeInput {
  readonly ticketId: string;
  readonly actorId: string;
  /** Entries to ADD. Additive only — a narrowing call is refused. */
  readonly add: readonly string[];
  /** Why, in the founder's words. Ledgered so the change is never mysterious. */
  readonly reason: string;
}

export interface CreateTicketInput {
  id: string;
  type: TicketType;
  title: string;
  lane: string;
  interface?: string | null;
  /** The expert that does this ticket (D-025). Absent => `coding-agent`. */
  role?: string;
  writeScope: string[];
  dependsOn?: string[];
  acceptance?: AcceptanceCriterion[];
  verify?: string | null;
}
