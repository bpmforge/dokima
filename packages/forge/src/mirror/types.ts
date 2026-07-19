/**
 * Mirror write-through contract (W6-03, FR-T5, SC-03, SC-15): the shapes
 * this module trades in. Everything here is duck-typed against the
 * `tickets`/`harbormaster` packages' real types rather than importing
 * them — packages/forge/package.json declares zero workspace
 * dependencies (same constraint documented in ../types.ts and
 * ../gitea.ts), and this ticket's write_scope
 * (`packages/forge/src/mirror/**`) doesn't cover package.json anyway.
 * The caller (a future harbormaster ticket, per ARCHITECTURE.md law 5:
 * "only harbormaster imports forge write paths") adapts its real
 * `Ticket`/`CloseReceipt` shapes onto these before calling in.
 */
import type { IssueComment, IssueInfo } from '../types.js';

/**
 * FR-T5's four write-through verbs. `start` and `release` are
 * deliberately absent — the SRS lists only these four as mirrored.
 */
export type MirrorVerb = 'claim' | 'evidence' | 'close' | 'accept';

/** Which machine identity performs each verb's forge write (SC-03). */
export const MIRROR_VERB_IDENTITY: Record<MirrorVerb, 'maker' | 'reviewer'> = {
  claim: 'maker',
  evidence: 'maker',
  close: 'maker',
  accept: 'reviewer',
};

export interface MirrorTicketRef {
  ticketId: string;
  issueNumber: number;
}

/**
 * claim = assign + label (FR-T5). `updateIssue` is full-replace on both
 * forges (GitHub REST PATCH and Gitea PUT /issues/{n}/labels both replace
 * the whole array — see gitea-issues.ts/github-issues.ts), and
 * `ForgeAdapter` has no read method to fetch-then-merge from inside this
 * module (adding one is out of this ticket's write_scope). So claim writes
 * the FULL label/assignee set every time: `existingLabels`/
 * `existingAssignees` are merged with `label`/`assigneeLogin` before the
 * write, but if the caller omits them, any pre-existing labels/assignees
 * on the mirrored issue are silently overwritten. The caller (harbormaster,
 * which has the issue's labels from its own `createIssue` call) must pass
 * the current set to preserve it.
 */
export interface MirrorClaimRequest {
  verb: 'claim';
  assigneeLogin: string;
  label: string;
  /** Labels already on the issue that must survive the write (e.g. type/priority/wave labels set at creation). */
  existingLabels?: string[];
  /** Assignees already on the issue that must survive the write. */
  existingAssignees?: string[];
}

/** evidence = comment (FR-T5) — a ticket's `comment` verb mirrors as a plain issue comment. */
export interface MirrorEvidenceRequest {
  verb: 'evidence';
  body: string;
}

/**
 * close = state + receipt comment (FR-T5): the issue is closed and a
 * comment carrying the close receipt is posted so the forge timeline is
 * a self-contained audit trail (SC-15) — no need to cross-reference the
 * local event log to see why a ticket closed.
 */
export interface MirrorCloseReceiptSummary {
  ticketId: string;
  ownerId: string;
  verifyCommand: string;
  verifyExitCode: number;
  commits: string[];
  files: string[];
  mintedAt: string;
}

export interface MirrorCloseRequest {
  verb: 'close';
  receipt: MirrorCloseReceiptSummary;
}

/** accept = reviewer comment (FR-T5) — posted under the reviewer identity, never the maker's. */
export interface MirrorAcceptRequest {
  verb: 'accept';
  body: string;
}

export type MirrorWriteRequest =
  MirrorClaimRequest | MirrorEvidenceRequest | MirrorCloseRequest | MirrorAcceptRequest;

/** What a successful write-through produced, for the caller to fold into ticket history. */
export interface MirrorWriteResult {
  verb: MirrorVerb;
  identity: 'maker' | 'reviewer';
  issue?: IssueInfo;
  comment?: IssueComment;
}
