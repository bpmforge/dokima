import { describe, expect, it } from 'vitest';
import { shippedSinceMidnight } from './shippedTicker.js';
import { makeBoardTicket } from './test-helpers.js';

const NOW = new Date('2026-07-15T18:00:00');

function doneTicket(id: string, closedAt: string, commits: string[]) {
  return makeBoardTicket({
    id,
    status: 'done',
    closedAt,
    manifest: {
      files: ['x.ts'],
      verify: { command: 'pnpm test', exitCode: 0 },
      commits,
      closeReceipt: {
        ticketId: id,
        ownerId: 'agent-1',
        verify: { command: 'pnpm test', exitCode: 0 },
        commits,
        files: ['x.ts'],
        mintedAt: closedAt,
      },
    },
  });
}

describe('shippedSinceMidnight', () => {
  it('includes commits from tickets closed today, linked to their ticket', () => {
    const tickets = [doneTicket('W4-01', '2026-07-15T09:00:00', ['a1b2c3d'])];
    expect(shippedSinceMidnight(tickets, NOW)).toEqual([
      {
        sha: 'a1b2c3d',
        ticketId: 'W4-01',
        ticketTitle: 'Ticket W4-01',
        closedAt: '2026-07-15T09:00:00',
      },
    ]);
  });

  it('excludes commits from tickets closed before local midnight', () => {
    const tickets = [doneTicket('W4-01', '2026-07-14T23:59:00', ['old'])];
    expect(shippedSinceMidnight(tickets, NOW)).toEqual([]);
  });

  it('excludes tickets that are not done, or have no manifest yet', () => {
    const inProgress = makeBoardTicket({ id: 'W4-02', status: 'in_progress' });
    expect(shippedSinceMidnight([inProgress], NOW)).toEqual([]);
  });

  it('flattens multiple commits per ticket and sorts newest-first', () => {
    const tickets = [
      doneTicket('W4-01', '2026-07-15T08:00:00', ['c1']),
      doneTicket('W4-02', '2026-07-15T10:00:00', ['c2', 'c3']),
    ];
    expect(shippedSinceMidnight(tickets, NOW).map((c) => c.sha)).toEqual([
      'c2',
      'c3',
      'c1',
    ]);
  });
});
