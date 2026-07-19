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
 *     no receipt comment, or none of the close receipt's commits show up
 *     in git history).
 *   - VERIFIED: matched to a forge issue, and — for `done` tickets — the
 *     issue is closed with a receipt comment and at least one receipt
 *     commit is present in git history. Non-`done` tickets with a mirror
 *     mapping are VERIFIED trivially (there's no completion claim yet to
 *     back up).
 * Tickets with no mirror mapping and non-`done` status aren't graded —
 * they simply haven't reached the point where mirroring is expected.
 *
 * `gitCommits` and `forgeIssues`/`forgeComments` are caller-supplied data
 * (from packages/git and a forge adapter respectively) — this module only
 * grades, it doesn't fetch either.
 */
import type { IssueComment, IssueInfo } from '../types.js';

export type ReconciliationGrade = 'VERIFIED' | 'UNVERIFIED' | 'ORPHAN';

export interface LocalTicketSnapshot {
  ticketId: string;
  status: string;
  issueNumber: number | null;
  closeReceiptCommits: string[];
}

export interface GitCommitRef {
  sha: string;
}

export interface ReconciliationInput {
  localTickets: LocalTicketSnapshot[];
  forgeIssues: IssueInfo[];
  forgeComments: Record<number, IssueComment[]>;
  gitCommits: GitCommitRef[];
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

function hasReceiptComment(comments: IssueComment[], ticketId: string): boolean {
  return comments.some(
    (c) => c.body.includes(ticketId) && /receipt|verify|exit/i.test(c.body),
  );
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
  if (!hasReceiptComment(comments, ticket.ticketId)) {
    reasons.push('no close-receipt comment found on the forge issue');
  }
  if (!commitsOverlap(ticket.closeReceiptCommits, input.gitCommits)) {
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
