/**
 * Wire types for the board (API_DESIGN §2 "tickets", §4 canonical shapes;
 * DATABASE.md §3 `tickets`/`board`). apps/web may only depend on
 * `@dokima/shared` types (ARCHITECTURE §4) — these are hand-mirrored
 * from `packages/tickets/src/types.ts`, not imported, by design: the UI
 * trusts the REST/WS wire contract, never the domain package directly.
 */

export type TicketType = 'epic' | 'story' | 'task' | 'bug';

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
  /**
   * `'reject'` was missing here until W22-13 while the server had been
   * projecting it all along (packages/tickets/src/reducer.ts, `ticket.rejected`
   * -> `pushHistory(..., 'reject', ...)`). This file is a hand-kept mirror —
   * apps/web has no workspace dependencies, so the browser bundle never pulls
   * in @dokima/tickets — and a mirror that omits a verb the wire sends does not
   * merely under-describe it: TypeScript makes any component that narrows on
   * that verb a compile error, so the rejection was unreachable in the UI by
   * construction rather than by oversight.
   */
  verb: 'claim' | 'start' | 'close' | 'accept' | 'reject' | 'release' | 'comment';
  actorId: string;
  at: string;
  body?: string;
}

export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  lane: string;
  ownerId: string | null;
  status: TicketStatus;
  dependsOn: string[];
  acceptance: AcceptanceCriterion[];
  manifest: TicketManifest | null;
  history: TicketHistoryEntry[];
  claimedAt: string | null;
  closedAt: string | null;
}

/**
 * `GET /projects/{id}/tickets` row (DATABASE.md §3 `board` projection,
 * recomputed on every event): the ticket contract plus the derived
 * claimability/staleness flags the board renders badges from.
 */
export interface BoardTicket extends Ticket {
  claimable: boolean;
  staleBlocked: boolean;
  wave: number;
  sortKey: string;
}

/** Every list endpoint (API_DESIGN §4 "canonical shapes"). */
export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}

/** RFC 7807 `application/problem+json` refusal (API_DESIGN §1/§4, FR-T4). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  request_id: string;
  rule?: string;
  evidence?: unknown;
}

/** `loop.heartbeat` WS payload (API_DESIGN §3), keyed by the ticket a berth works on. */
export interface HeartbeatData {
  ticket: string;
  pass: string;
  age_s: number;
}
