import { describe, expect, it } from 'vitest';
import {
  reconcile,
  type LocalTicketSnapshot,
  type ReconciliationInput,
} from './reconciliation.js';
import type { IssueComment, IssueInfo } from '../types.js';

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

function comment(body: string): IssueComment {
  return {
    id: 1,
    body,
    authorLogin: 'shipwright-maker',
    htmlUrl: 'https://example.test/comment',
    createdAt: '2026-07-18T00:00:00.000Z',
  };
}

function baseInput(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    localTickets: [],
    forgeIssues: [],
    forgeComments: {},
    gitCommits: [],
    ...overrides,
  };
}

describe('reconcile', () => {
  it('grades a done ticket VERIFIED when the forge issue is closed, has a receipt comment, and a commit matches', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceiptCommits: ['abc1234'],
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: { 7: [comment('Close receipt for W6-03 — verify exit 0')] },
        gitCommits: [{ sha: 'abc1234def' }],
      }),
    );
    expect(report.tickets).toEqual([
      { ticketId: 'W6-03', grade: 'VERIFIED', reasons: expect.any(Array) },
    ]);
    expect(report.localNotOnForge).toEqual([]);
    expect(report.forgeNotLocal).toEqual([]);
  });

  it('grades ORPHAN when a done ticket has no matching forge issue', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: null,
      closeReceiptCommits: [],
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
      closeReceiptCommits: [],
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
      closeReceiptCommits: [],
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

  it('grades UNVERIFIED when no receipt comment is found', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceiptCommits: [],
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: { 7: [comment('just chatting, no receipt here')] },
      }),
    );
    expect(report.tickets[0]).toMatchObject({ grade: 'UNVERIFIED' });
    expect(report.tickets[0]!.reasons.join(' ')).toMatch(/receipt/);
  });

  it('grades UNVERIFIED when the close receipt commits are absent from git history', () => {
    const ticket: LocalTicketSnapshot = {
      ticketId: 'W6-03',
      status: 'done',
      issueNumber: 7,
      closeReceiptCommits: ['deadbeef'],
    };
    const report = reconcile(
      baseInput({
        localTickets: [ticket],
        forgeIssues: [issue({ number: 7, state: 'closed' })],
        forgeComments: { 7: [comment('Close receipt for W6-03, verify exit 0')] },
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
      closeReceiptCommits: [],
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
      closeReceiptCommits: [],
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
