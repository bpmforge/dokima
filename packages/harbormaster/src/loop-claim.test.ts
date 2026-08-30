/**
 * loop-claim.test.ts — what survived W21-36.
 *
 * This file used to be the claim loop's suite: eleven cases over
 * `runClaimLoop`, all passing, for a function `apps/*` never called. They went
 * with it. Keeping them would have kept the exact trap the deletion removed —
 * a green suite standing in for a live path, which is how W21-12's worktree
 * provisioning passed a full gate and never once executed.
 *
 * The abandoned-claim sweep stays, because it is LIVE: `loop-land-reclaim.ts`
 * calls `findAbandonedTickets` and `loop-land.ts` calls that at every idle
 * turn. These are its fixtures, unchanged.
 */
import { describe, expect, it } from 'vitest';
import { type Ticket } from '@dokima/tickets';
import { findAbandonedTickets, STALE_CLAIM_MS } from './loop-claim.js';

describe('reclaiming a claim whose owner is gone (W13-12)', () => {
  const NOW = '2026-08-19T12:00:00.000Z';
  const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

  function ticket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 'T-1',
      type: 'task',
      title: 'a ticket',
      lane: 'core',
      ownerId: 'worker-1',
      status: 'in_progress',
      interface: null,
      writeScope: ['src/**'],
      dependsOn: [],
      acceptance: [],
      verify: null,
      manifest: null,
      history: [],
      evidence: [],
      claimedAt: ago(60 * 60_000),
      closedAt: null,
      ...overrides,
    } as Ticket;
  }

  it(
    'RED FIXTURE: a held ticket with no activity for longer than the bound is ' +
      'reclaimable. Before this it stayed in in_progress forever and the next ' +
      'run silently found nothing to do',
    () => {
      const found = findAbandonedTickets(
        [ticket()],
        [{ ticketId: 'T-1', createdAt: ago(45 * 60_000) }],
        NOW,
      );
      expect(found.map((t) => t.id)).toEqual(['T-1']);
    },
  );

  it(
    'DOES NOT REAP A LIVE SESSION — the one thing this must never do. A running ' +
      'session emits a tool call per turn, so recent events ARE the heartbeat; ' +
      'claimedAt alone could not tell a long healthy session from a dead one',
    () => {
      const found = findAbandonedTickets(
        // Claimed an hour ago, still working ten seconds ago.
        [ticket({ claimedAt: ago(60 * 60_000) })],
        [
          { ticketId: 'T-1', createdAt: ago(60 * 60_000) },
          { ticketId: 'T-1', createdAt: ago(10_000) },
        ],
        NOW,
      );
      expect(found).toEqual([]);
    },
  );

  it('the bound is longer than the longest silence a healthy session can produce', () => {
    // One verify (10 min) plus one local model call (5 min) is the worst
    // legitimate gap; the bound must clear it with room.
    expect(STALE_CLAIM_MS).toBeGreaterThan((10 + 5) * 60_000);
  });

  it('leaves ready, in_review and done tickets alone — only a HELD ticket can be abandoned', () => {
    for (const status of ['ready', 'in_review', 'done', 'blocked'] as const) {
      expect(
        findAbandonedTickets([ticket({ status })], [], NOW),
      ).toEqual([]);
    }
  });

  it('treats an unreadable or missing timestamp as no evidence of life, not as immortality', () => {
    expect(
      findAbandonedTickets([ticket()], [{ ticketId: 'T-1', createdAt: 'not-a-date' }], NOW),
    ).toHaveLength(1);
    expect(findAbandonedTickets([ticket()], [], NOW)).toHaveLength(1);
  });

  it('ignores events belonging to other tickets', () => {
    const found = findAbandonedTickets(
      [ticket()],
      [{ ticketId: 'T-2', createdAt: ago(1000) }],
      NOW,
    );
    expect(found).toHaveLength(1);
  });
});
