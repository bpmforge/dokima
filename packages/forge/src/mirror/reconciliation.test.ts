import { describe, expect, it } from 'vitest';
import {
  reconcile,
  type LocalTicketSnapshot,
  type ReconciliationInput,
} from './reconciliation.js';
import { computeReceiptAnchor, type MirrorCloseReceiptSummary } from './types.js';
import type { IssueComment, IssueInfo } from '../types.js';

const REVIEWER_LOGIN = 'dokima-reviewer';
const MAKER_LOGIN = 'dokima-maker';

const RECEIPT: MirrorCloseReceiptSummary = {
  ticketId: 'W6-03',
  ownerId: 'agent-1',
  verifyCommand: 'pnpm test',
  verifyExitCode: 0,
  commits: ['abc1234'],
  files: ['packages/forge/src/mirror/index.ts'],
  mintedAt: '2026-07-18T00:00:00.000Z',
};

function issue(overrides: Partial<IssueInfo> & { number: number }): IssueInfo {
  return {
    number: overrides.number,
    state: overrides.state ?? 'open',
    stateReason: overrides.stateReason ?? null,
    title: overrides.title ?? `issue ${overrides.number}`,
    body: overrides.body ?? null,
    htmlUrl: `https://example.test/issues/${overrides.number}`,
    labels: overrides.labels ?? [],
    assignees: overrides.assignees ?? [],
  };
}

function comment(body: string, authorLogin: string = REVIEWER_LOGIN): IssueComment {
  return {
    id: 1,
    body,
    authorLogin,
    htmlUrl: 'https://example.test/comment',
    createdAt: '2026-07-18T00:00:00.000Z',
  };
}

/** A genuine accept comment, as write-through.ts's acceptCommentBody would compose it. */
function acceptComment(receipt: MirrorCloseReceiptSummary): IssueComment {
  return comment(
    `looks good\n\nConfirms close receipt for ${receipt.ticketId}\n- anchor: ${computeReceiptAnchor(receipt)}`,
    REVIEWER_LOGIN,
  );
}

function baseInput(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    localTickets: [],
    forgeIssues: [],
    forgeComments: {},
    gitCommits: [],
    reviewerLogin: REVIEWER_LOGIN,
    ...overrides,
  };
}

describe('reconcile', () => {
  it('grades a done ticket VERIFIED when the forge issue is closed, has a reviewer-authored anchor comment, and a commit matches', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: RECEIPT,
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: { 7: [acceptComment(RECEIPT)] },
        gitCommits: [{ sha: 'abc1234def' }],
      }),
    );
    expect(report.tickets).toEqual([
      { ticketId: 'W6-03', grade: 'VERIFIED', reasons: expect.any(Array) },
    ]);
    expect(report.localNotOnForge).toEqual([]);
    expect(report.forgeNotLocal).toEqual([]);
  });

  it('SECURITY (W6-08/SC-15): a maker-authored comment with receipt-shaped text grades UNVERIFIED — the maker cannot self-attest completion', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: RECEIPT,
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: {
          7: [comment('receipt for W6-03, verify exit 0', MAKER_LOGIN)],
        },
        gitCommits: [{ sha: 'abc1234def' }],
      }),
    );
    expect(report.tickets[0]).toMatchObject({ ticketId: 'W6-03', grade: 'UNVERIFIED' });
    expect(report.tickets[0]!.reasons.join(' ')).toMatch(/reviewer-authored/);
  });

  it('SECURITY (W6-08/SC-15): a reviewer-authored comment without the real anchor also fails — text/identity alone is not enough', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: RECEIPT,
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: {
          7: [comment('receipt for W6-03, verify exit 0', REVIEWER_LOGIN)],
        },
        gitCommits: [{ sha: 'abc1234def' }],
      }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'UNVERIFIED' });
  });

  it('SECURITY (W6-08/SC-15): the real anchor authored under the maker identity also fails — identity is checked independently of the anchor', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: RECEIPT,
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: {
          7: [
            comment(
              `Confirms close receipt for W6-03\n- anchor: ${computeReceiptAnchor(RECEIPT)}`,
              MAKER_LOGIN,
            ),
          ],
        },
        gitCommits: [{ sha: 'abc1234def' }],
      }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'UNVERIFIED' });
  });

  it('grades ORPHAN when a done ticket has no matching forge issue', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: null,
      closeReceipt: null,
    };
    const report = reconcile(baseInput({ localTickets: [ticket] }));
    expect(report.tickets[0]).toMatchObject({ ticketId: 'W6-03', grade: 'ORPHAN' });
    expect(report.localNotOnForge).toEqual(['W6-03']);
  });

  it('grades ORPHAN when the mapped issue number no longer exists on the forge', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 99,
      closeReceipt: null,
    };
    const report = reconcile(baseInput({ localTickets: [ticket], forgeIssues: [] }));
    expect(report.tickets[0]).toMatchObject({ grade: 'ORPHAN' });
    expect(report.localNotOnForge).toEqual(['W6-03']);
  });

  it('grades UNVERIFIED when the forge issue is still open despite local done status', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: null,
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'open' })],
      }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'UNVERIFIED' });
    expect(report.tickets[0]!.reasons.join(' ')).toMatch(/still open/);
  });

  it('grades UNVERIFIED when no local close receipt is recorded at all', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: null,
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: { 7: [comment('just chatting, no receipt here')] },
      }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'UNVERIFIED' });
    expect(report.tickets[0]!.reasons.join(' ')).toMatch(/anchor/);
  });

  it('grades UNVERIFIED when the close receipt commits are absent from git history', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceipt: { ...RECEIPT, commits: ['deadbeef'] },
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: { 7: [acceptComment({ ...RECEIPT, commits: ['deadbeef'] })] },
        gitCommits: [{ sha: 'unrelated123' }],
      }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'UNVERIFIED' });
    expect(report.tickets[0]!.reasons.join(' ')).toMatch(/commit/);
  });

  it('grades a non-done mirrored ticket VERIFIED trivially (no completion claim to back up)', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-04',
      status: 'in_progress',
      issueNumber: 8,
      closeReceipt: null,
    };
    const report = reconcile(
      baseInput({ localTickets: [ticket], forgeIssues: [issue({ number: 8 })] }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'VERIFIED' });
  });

  it('skips grading a non-done ticket that has never been mirrored', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W7-01',
      status: 'ready',
      issueNumber: null,
      closeReceipt: null,
    };
    const report = reconcile(baseInput({ localTickets: [ticket] }));
    expect(report.tickets).toEqual([]);
    expect(report.localNotOnForge).toEqual([]);
  });

  it('reports forge-only issues in forgeNotLocal (two-way drift)', () => {
    const report = reconcile(
      baseInput({
        localTickets: [],
        forgeIssues: [issue({ number: 42 })],
      }),
    );
    expect(report.forgeNotLocal).toEqual([42]);
  });
});
