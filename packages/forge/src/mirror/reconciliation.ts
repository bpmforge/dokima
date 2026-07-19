/**
 * Reconciliation audit (SC-15, FR-T5 AC-3): a two-way drift report between
 * local ticket state and the forge mirror, plus a per-ticket grade against
 * both the forge issue and git history — the forge/git evidence a maker
 * can't silently fake because it never held the reviewer token or a merge
 * bit (SC-03).
 *
 * Grading (plain reading of "VERIFIED/UNVERIFIED/ORPHAN against issues +
 * git history" — documented here since the acceptance criterion names the
 * three grades without defining them):
 *   - ORPHAN: the local ticket has no matching forge issue at all (never
 *     mirrored, or the issue vanished) — nothing to verify against.
 *   - UNVERIFIED: matched to a forge issue, but for a `done` ticket the
 *     forge side doesn't back up the completion claim (issue still open,
 *     no reviewer-authored comment carrying the real close-receipt anchor,
 *     or none of the close receipt's commits show up in git history).
 *   - VERIFIED: matched to a forge issue, and — for `done` tickets — the
 *     issue is closed, a comment authored by the reviewer identity carries
 *     the exact close-receipt anchor (W6-08/SC-15 — see
 *     `hasReceiptComment`), and at least one receipt commit is present in
 *     git history. Non-`done` tickets with a mirror mapping are VERIFIED
 *     trivially (there's no completion claim yet to back up).
 * Tickets with no mirror mapping and non-`done` status aren't graded —
 * they simply haven't reached the point where mirroring is expected.
 *
 * `gitCommits` and `forgeIssues`/`forgeComments` are caller-supplied data
 * (from packages/git and a forge adapter respectively) — this module only
 * grades, it doesn't fetch either.
 */
import type { IssueComment, IssueInfo } from '../types.js';
import { computeReceiptAnchor, type MirrorCloseReceiptSummary } from './types.js';

export type ReconciliationGrade = 'VERIFIED' | 'UNVERIFIED' | 'ORPHAN';

export interface LocalTicketSnapshot {
  ticketId: string;
  status: string;
  issueNumber: number | null;
  /**
   * The ticket's real close receipt (SC-15/W6-08) — null if the ticket has
   * never actually gone through a real close locally. A single trusted
   * record instead of separately caller-supplied commit/anchor fields that
   * could drift out of sync with each other.
   */
  closeReceipt: MirrorCloseReceiptSummary | null;
}

export interface GitCommitRef {
  sha: string;
}

export interface ReconciliationInput {
  localTickets: LocalTicketSnapshot[];
  forgeIssues: IssueInfo[];
  forgeComments: Record<number, IssueComment[]>;
  gitCommits: GitCommitRef[];
  /**
   * Forge login of the reviewer machine identity (MirrorIdentityConfig.
   * reviewerLogin) — the only identity whose comment can satisfy
   * `hasReceiptComment`. Never the maker login: the maker's own `evidence`
   * verb can post arbitrary comments under the maker identity, so trusting
   * a maker-authored comment would let the maker self-attest completion
   * (the W6-08 bypass — docs/LESSONS.md L-42).
   */
  reviewerLogin: string;
}

export interface TicketReconciliationResult {
  ticketId: string;
  grade: ReconciliationGrade;
  reasons: string[];
}

export interface DriftReport {
  /** Local tickets with no matching forge issue. */
  localNotOnForge: string[];
  /** Forge issues with no matching local ticket. */
  forgeNotLocal: number[];
  tickets: TicketReconciliationResult[];
}

function findIssue(issues: IssueInfo[], issueNumber: number): IssueInfo | undefined {
  return issues.find((i) => i.number === issueNumber);
}

/**
 * W6-08/SC-15 fix: grading VERIFIED must never come from matching free
 * text (the L-42 bypass — a maker's own `evidence` comment could contain
 * "receipt for W6-03, verify exit 0" and satisfy a text-only check). This
 * requires BOTH (a) the comment is authored by the reviewer identity —
 * the maker never holds the reviewer token (SC-03), so it cannot post as
 * the reviewer — and (b) the comment carries the exact anchor computed
 * from the ticket's real close receipt, which the accept verb embeds
 * verbatim (write-through.ts) and a maker cannot forge without already
 * knowing every field of a real, already-minted receipt.
 */
function hasReceiptComment(
  comments: IssueComment[],
  reviewerLogin: string,
  closeReceipt: MirrorCloseReceiptSummary | null,
): boolean {
  if (!closeReceipt) return false;
  const anchor = computeReceiptAnchor(closeReceipt);
  return comments.some((c) => c.authorLogin === reviewerLogin && c.body.includes(anchor));
}

function commitsOverlap(receiptCommits: string[], gitCommits: GitCommitRef[]): boolean {
  if (receiptCommits.length === 0) return true;
  const shas = gitCommits.map((c) => c.sha);
  return receiptCommits.some((rc) =>
    shas.some((sha) => sha.startsWith(rc) || rc.startsWith(sha)),
  );
}

function gradeTicket(
  ticket: LocalTicketSnapshot,
  input: ReconciliationInput,
): TicketReconciliationResult | null {
  const issue =
    ticket.issueNumber === null
      ? undefined
      : findIssue(input.forgeIssues, ticket.issueNumber);

  if (!issue) {
    if (ticket.status !== 'done' && ticket.issueNumber === null) return null;
    return {
      ticketId: ticket.ticketId,
      grade: 'ORPHAN',
      reasons: ['no matching forge issue found for this ticket'],
    };
  }

  if (ticket.status !== 'done') {
    return {
      ticketId: ticket.ticketId,
      grade: 'VERIFIED',
      reasons: ['mirror mapping present; not yet closed'],
    };
  }

  const reasons: string[] = [];
  if (issue.state !== 'closed') {
    reasons.push('forge issue is still open despite local done status');
  }
  const comments = input.forgeComments[ticket.issueNumber!] ?? [];
  if (!hasReceiptComment(comments, input.reviewerLogin, ticket.closeReceipt)) {
    reasons.push(
      'no reviewer-authored comment carrying the real close-receipt anchor found on the forge issue',
    );
  }
  if (!commitsOverlap(ticket.closeReceipt?.commits ?? [], input.gitCommits)) {
    reasons.push('none of the close receipt commits were found in git history');
  }

  return {
    ticketId: ticket.ticketId,
    grade: reasons.length === 0 ? 'VERIFIED' : 'UNVERIFIED',
    reasons:
      reasons.length === 0
        ? [
            'forge issue closed, receipt comment present, commit(s) verified in git history',
          ]
        : reasons,
  };
}

export function reconcile(input: ReconciliationInput): DriftReport {
  const tickets = input.localTickets
    .map((t) => gradeTicket(t, input))
    .filter((r): r is TicketReconciliationResult => r !== null);

  // Drift only covers tickets that were actually graded (i.e. expected to
  // be mirrored) — an un-mirrored, not-yet-`done` ticket is not drift, it
  // simply hasn't reached the point where mirroring applies (see gradeTicket).
  const localNotOnForge = tickets
    .filter((t) => t.grade === 'ORPHAN')
    .map((t) => t.ticketId);

  const mappedIssueNumbers = new Set(
    input.localTickets.map((t) => t.issueNumber).filter((n): n is number => n !== null),
  );
  const forgeNotLocal = input.forgeIssues
    .filter((i) => !mappedIssueNumbers.has(i.number))
    .map((i) => i.number);

  return { localNotOnForge, forgeNotLocal, tickets };
}
