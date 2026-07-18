import { describe, expect, it } from 'vitest';
import type { BoardTicket } from '../board/types.js';
import type { ArtifactListItem, ReceiptRecord } from '../artifacts/types.js';
import { resultKey, searchDocs, searchReceipts, searchTickets } from './search.js';

function ticket(overrides: Partial<BoardTicket> = {}): BoardTicket {
  return {
    id: 'W2-04',
    type: 'task',
    title: 'Wire the board',
    lane: 'ui',
    ownerId: null,
    status: 'ready',
    dependsOn: [],
    acceptance: [],
    manifest: null,
    history: [],
    claimedAt: null,
    closedAt: null,
    claimable: true,
    staleBlocked: false,
    wave: 0,
    sortKey: 'W2-04',
    ...overrides,
  };
}

describe('searchTickets', () => {
  it('returns nothing for an empty query', () => {
    expect(searchTickets([ticket()], '')).toEqual([]);
    expect(searchTickets([ticket()], '   ')).toEqual([]);
  });

  it('ranks an exact id match before a title-only match', () => {
    const exact = ticket({ id: 'W2-04', title: 'Wire the board' });
    const titleOnly = ticket({ id: 'W3-01', title: 'w2-04 follow-up' });
    const results = searchTickets([titleOnly, exact], 'W2-04');
    expect(results.map((r) => r.id)).toEqual(['W2-04', 'W3-01']);
  });

  it('matches case-insensitively on title', () => {
    const results = searchTickets([ticket({ title: 'Wire the Board' })], 'board');
    expect(results).toHaveLength(1);
  });

  it('caps results per kind', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ticket({ id: `W9-${i}`, title: `matching ticket ${i}` }),
    );
    expect(searchTickets(many, 'matching')).toHaveLength(8);
  });
});

describe('searchDocs', () => {
  it('matches on path or title', () => {
    const docs: ArtifactListItem[] = [
      { path: 'docs/API_DESIGN.md', title: 'API Design' },
      { path: 'docs/TESTING.md', title: 'Test Strategy' },
    ];
    expect(searchDocs(docs, 'api').map((r) => r.kind === 'doc' && r.path)).toEqual([
      'docs/API_DESIGN.md',
    ]);
    expect(searchDocs(docs, 'strategy').map((r) => r.kind === 'doc' && r.path)).toEqual([
      'docs/TESTING.md',
    ]);
  });
});

describe('searchReceipts', () => {
  it('matches on receipt id', () => {
    const receipts: ReceiptRecord[] = [
      {
        id: 'receipt-1',
        kind: 'close',
        projectId: 'p1',
        phase: 4,
        ticketId: 'W2-04',
        validators: [],
        inputTreeHash: 'abc',
        verifyCommand: 'pnpm test',
        verifyExit: 0,
        signedBy: 'operator',
        payload: null,
        createdAt: '2026-07-18T00:00:00Z',
      },
    ];
    expect(searchReceipts(receipts, 'receipt-1')).toHaveLength(1);
    expect(searchReceipts(receipts, 'nope')).toHaveLength(0);
  });
});

describe('resultKey', () => {
  it('is unique per kind + identifier', () => {
    expect(
      resultKey({ kind: 'ticket', id: 'W2-04', title: '', status: '', lane: '' }),
    ).toBe('ticket:W2-04');
    expect(resultKey({ kind: 'doc', path: 'docs/X.md', title: '' })).toBe(
      'doc:docs/X.md',
    );
    expect(resultKey({ kind: 'receipt', id: 'r-1', title: '' })).toBe('receipt:r-1');
  });
});
