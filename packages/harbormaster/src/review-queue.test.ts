import { describe, expect, it } from 'vitest';
import type { ReceiptRecord } from '@shipwright/events';
import {
  assertExecutionAllowed,
  NeverAutoExecutionBlockedError,
} from './review-queue-classifier.js';
import {
  buildQueueProjection,
  buildReviewCard,
  diffStatFromFiles,
  LEVERAGE_RANK,
} from './review-queue.js';
import type { ActionDescriptor } from './review-queue-types.js';

const NOW = '2026-07-16T00:00:00.000Z';

function fakeReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: 'receipt-1',
    kind: 'close',
    projectId: 'proj-1',
    phase: 4,
    ticketId: 'W3-05',
    validators: [],
    inputTreeHash: 'deadbeef',
    verifyCommand: 'pnpm test',
    verifyExit: 0,
    signedBy: null,
    payload: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('diffStatFromFiles', () => {
  it('derives filesChanged from the real changed-file list', () => {
    const files = ['a.ts', 'b.ts'];
    expect(diffStatFromFiles(files)).toEqual({ filesChanged: 2, files });
  });

  it('is zero for an empty file list', () => {
    expect(diffStatFromFiles([])).toEqual({ filesChanged: 0, files: [] });
  });
});

describe('buildReviewCard', () => {
  it('carries diff-stat and receipts on every card (FR-H4 acceptance 2)', () => {
    const card = buildReviewCard({
      id: 'card-1',
      kind: 'merge',
      riskClass: 'main-merge',
      title: 'W3-05 ready to merge',
      summary: 'Morning-review queue + NEVER-AUTO enforcement',
      files: ['packages/harbormaster/src/review-queue.ts'],
      receipts: [fakeReceipt()],
      ticketId: 'W3-05',
      createdAt: NOW,
    });
    expect(card.diffStat).toEqual({
      filesChanged: 1,
      files: ['packages/harbormaster/src/review-queue.ts'],
    });
    expect(card.receipts).toHaveLength(1);
    expect(card.leverage).toBe(LEVERAGE_RANK.merge);
  });

  it('rejects an unknown card kind', () => {
    expect(() =>
      buildReviewCard({
        id: 'card-x',
        // @ts-expect-error — deliberately invalid kind for the runtime guard
        kind: 'not-a-kind',
        riskClass: null,
        title: 't',
        summary: 's',
        files: [],
        receipts: [],
        createdAt: NOW,
      }),
    ).toThrow(/unknown review-card kind/);
  });
});

describe('buildQueueProjection — sorted by leverage (FR-H4 acceptance 2, merges first)', () => {
  it('orders merge > approval > clarification > digest', () => {
    const make = (kind: 'merge' | 'approval' | 'clarification' | 'digest', id: string) =>
      buildReviewCard({
        id,
        kind,
        riskClass: null,
        title: id,
        summary: id,
        files: [],
        receipts: [],
        createdAt: NOW,
      });

    const cards = [
      make('digest', 'd1'),
      make('clarification', 'c1'),
      make('merge', 'm1'),
      make('approval', 'a1'),
    ];
    const projected = buildQueueProjection(cards);
    expect(projected.map((c) => c.id)).toEqual(['m1', 'a1', 'c1', 'd1']);
  });

  it('tie-breaks equal leverage by createdAt, oldest first', () => {
    const older = buildReviewCard({
      id: 'm-older',
      kind: 'merge',
      riskClass: null,
      title: 'older',
      summary: 'older',
      files: [],
      receipts: [],
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    const newer = buildReviewCard({
      id: 'm-newer',
      kind: 'merge',
      riskClass: null,
      title: 'newer',
      summary: 'newer',
      files: [],
      receipts: [],
      createdAt: NOW,
    });
    expect(buildQueueProjection([newer, older]).map((c) => c.id)).toEqual([
      'm-older',
      'm-newer',
    ]);
  });

  it('does not mutate the input array', () => {
    const a = buildReviewCard({
      id: 'a',
      kind: 'digest',
      riskClass: null,
      title: 'a',
      summary: 'a',
      files: [],
      receipts: [],
      createdAt: NOW,
    });
    const b = buildReviewCard({
      id: 'b',
      kind: 'merge',
      riskClass: null,
      title: 'b',
      summary: 'b',
      files: [],
      receipts: [],
      createdAt: NOW,
    });
    const input = [a, b];
    buildQueueProjection(input);
    expect(input).toEqual([a, b]);
  });
});

describe('end-to-end: NEVER-AUTO actions never execute in-loop, work stages instead (FR-H4 acceptance 1)', () => {
  it('a main-merge action is refused for execution but still becomes a staged queue card', () => {
    const action: ActionDescriptor = { targetBranch: 'main', kind: 'merge' };

    // The enforcement point refuses the actual side-effecting call...
    expect(() => assertExecutionAllowed(action)).toThrow(NeverAutoExecutionBlockedError);

    // ...but the ticket's real diff and close receipt still surface as a
    // staged card on the queue instead — the "PR opened/drafted, parked
    // in_review" path (out of this module's write_scope: the ticket-status
    // transition itself is `@shipwright/tickets`' `closeTicket`, already
    // exercised by W3-01b/c's `runCloseGate`/`runLandLoop`; this module
    // only guarantees the card carries real, verified data).
    const card = buildReviewCard({
      id: 'card-w3-05',
      kind: 'merge',
      riskClass: 'main-merge',
      title: 'W3-05 ready to merge',
      summary: 'Staged: main-merge is NEVER-AUTO, human approval required',
      files: ['packages/harbormaster/src/review-queue.ts'],
      receipts: [fakeReceipt({ ticketId: 'W3-05' })],
      ticketId: 'W3-05',
      createdAt: NOW,
    });
    expect(card.riskClass).toBe('main-merge');
    expect(card.diffStat.filesChanged).toBeGreaterThan(0);
    expect(card.receipts).toHaveLength(1);
  });

  it('a non-never-auto action (e.g. a clarification) is allowed to proceed without staging', () => {
    const action: ActionDescriptor = { command: 'echo hello' };
    expect(assertExecutionAllowed(action)).toBeNull();
  });
});
