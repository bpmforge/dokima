/**
 * W20-09 (D-030): Otto orders the funnel and can do nothing else.
 *
 * The fixtures that matter are the ones that would let the coordinator lie:
 * dropping an item, answering one, or ranking by anything but the DAG and the
 * clock. Two of those are impossible by type; this file proves the third and
 * pins the total-order property so a future "just filter the noisy ones" can
 * never land quietly.
 */
import { describe, expect, it } from 'vitest';
import {
  countBlockedDependents,
  isStuckTicket,
  FOUNDER_ITEM_CLASSES,
  orderFounderQueue,
  type FounderQueueItem,
} from './founder-queue.js';

const item = (over: Partial<FounderQueueItem> & { id: string }): FounderQueueItem => ({
  kind: 'founder-decision',
  actorId: 'threat-modeler',
  title: 'A question only you can answer',
  ticketId: null,
  openedAt: '2026-08-24T10:00:00.000Z',
  estimatedCostUsd: null,
  blocksRun: false,
  blockedDependents: 0,
  ...over,
});

describe('orderFounderQueue (W20-09, D-030)', () => {
  it('RED FIXTURE: every input appears in the output — the queue can never drop an item, so depth is always the TRUE open count', () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      item({ id: `i-${i}`, blockedDependents: i % 4, blocksRun: i === 7 }),
    );
    const out = orderFounderQueue(items);
    expect(out).toHaveLength(items.length);
    expect(new Set(out.map((o) => o.id))).toEqual(new Set(items.map((i) => i.id)));
    expect(out.map((o) => o.position)).toEqual(items.map((_, i) => i + 1));
  });

  it('orders by blocks-the-run, then blocked dependents, then age, then cost — and says which, mechanically', () => {
    const out = orderFounderQueue([
      item({ id: 'cheap', estimatedCostUsd: 0.4, openedAt: '2026-08-24T09:00:00.000Z' }),
      item({ id: 'old', openedAt: '2026-08-24T08:00:00.000Z' }),
      item({ id: 'unblocks-4', blockedDependents: 4 }),
      item({ id: 'stops-everything', blocksRun: true }),
      item({ id: 'unblocks-1', blockedDependents: 1 }),
    ]);
    expect(out.map((o) => o.id)).toEqual([
      'stops-everything',
      'unblocks-4',
      'unblocks-1',
      'old',
      'cheap',
    ]);
    expect(out[0]!.reason).toBe('blocks the whole run');
    expect(out[1]!.reason).toBe('blocks 4 tickets');
    expect(out[2]!.reason).toBe('blocks 1 ticket');
    expect(out[4]!.reason).toBe('nothing else is waiting on it');
  });

  it('is deterministic and pure — same input, same order, and the input is never mutated', () => {
    const items = [
      item({ id: 'b' }),
      item({ id: 'a' }),
      item({ id: 'c', blockedDependents: 2 }),
    ];
    const snapshot = JSON.stringify(items);
    const first = orderFounderQueue(items).map((o) => o.id);
    const second = orderFounderQueue([...items].reverse()).map((o) => o.id);
    expect(first).toEqual(second);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it('carries exactly the OPERATIONS.md classes and invents none of its own', () => {
    const out = orderFounderQueue(
      FOUNDER_ITEM_CLASSES.map((kind, i) => item({ id: `k-${i}`, kind })),
    );
    expect(new Set(out.map((o) => o.kind))).toEqual(new Set(FOUNDER_ITEM_CLASSES));
    // The guard is that code and doc agree, not that the number never moves.
    // W21-26 added a sixth class — stuck-ticket — as a founder decision, and
    // OPERATIONS.md carries it; a class added in code alone still fails here.
    expect(FOUNDER_ITEM_CLASSES).toEqual([
      'founder-decision',
      'approval',
      'blocked-on-you',
      'acceptance',
      'interview',
      'stuck-ticket',
    ]);
  });
});

describe('countBlockedDependents (the "unblocks the most work" signal)', () => {
  const dag = [
    { id: 'T-1', dependsOn: [] },
    { id: 'T-2', dependsOn: ['T-1'] },
    { id: 'T-3', dependsOn: ['T-2'] },
    { id: 'T-4', dependsOn: ['T-1'] },
    { id: 'T-5', dependsOn: [] },
  ];

  it('counts transitive dependents, not just direct ones', () => {
    expect(countBlockedDependents('T-1', dag)).toBe(3); // T-2, T-3, T-4
    expect(countBlockedDependents('T-2', dag)).toBe(1); // T-3
    expect(countBlockedDependents('T-5', dag)).toBe(0);
  });

  it('an item with no ticket blocks nothing, and a cycle terminates rather than hanging', () => {
    expect(countBlockedDependents(null, dag)).toBe(0);
    const cyclic = [
      { id: 'A', dependsOn: ['B'] },
      { id: 'B', dependsOn: ['A'] },
    ];
    expect(countBlockedDependents('A', cyclic)).toBe(2);
  });
});

describe('a ticket that keeps being retried reaches the founder (W21-26)', () => {
  const h = (verb: string) => ({ verb });

  it('RED FIXTURE: the live shape — claimed, worked and released twice, never reviewed — is stuck', () => {
    expect(
      isStuckTicket({
        status: 'ready',
        history: [h('claim'), h('start'), h('comment'), h('release'), h('claim'), h('start'), h('comment'), h('release')],
      }),
    ).toBe(true);
  });

  it('one park is a bad attempt, not a pattern', () => {
    expect(
      isStuckTicket({ status: 'ready', history: [h('claim'), h('start'), h('release')] }),
    ).toBe(false);
  });

  /**
   * W21-43 REVERSED THIS ASSERTION DELIBERATELY, and the original was right
   * when it was written. It read "a ticket that has ever closed is making
   * progress by definition", which held while `close` was a one-way door:
   * nothing could take a ticket back out of review except accepting it.
   *
   * Once work can come BACK — a founder rejecting it (W21-42) — a close stops
   * being proof of progress, and a ticket that closed, was sent back, and now
   * parks repeatedly becomes the one a person most needs to see. It was the
   * single shape this predicate could not report, and PLAN-vault-002 hid in it
   * for exactly that reason. `accept` still disqualifies: accepted work is
   * finished.
   */
  it('a ticket that closed and was SENT BACK is stuck — a close is no longer proof of progress', () => {
    expect(
      isStuckTicket({
        status: 'ready',
        history: [h('claim'), h('close'), h('release'), h('claim'), h('release'), h('release')],
      }),
    ).toBe(true);
  });

  it('a ticket someone is working right now is not stuck — it is in progress', () => {
    expect(
      isStuckTicket({
        status: 'in_progress',
        history: [h('release'), h('release'), h('release')],
      }),
    ).toBe(false);
  });

  it('being noisy does not jump the queue — ordering stays mechanical (D-030)', () => {
    const ordered = orderFounderQueue([
      {
        id: 'stuck:T-1', kind: 'stuck-ticket', actorId: 'a', title: 'stuck', ticketId: 'T-1',
        openedAt: '2026-01-02T00:00:00Z', estimatedCostUsd: null, blocksRun: false, blockedDependents: 0,
      },
      {
        id: 'slate:1', kind: 'founder-decision', actorId: 'b', title: 'blocks everything', ticketId: null,
        openedAt: '2026-01-03T00:00:00Z', estimatedCostUsd: null, blocksRun: true, blockedDependents: 0,
      },
    ]);
    expect(ordered[0]!.id).toBe('slate:1');
    expect(ordered[1]!.reason).toContain('picked up and put back down');
  });
});

describe('isStuckTicket after a rejection (W21-43)', () => {
  it('RED FIXTURE: a ticket that closed, was sent back, and parks again is STUCK — the one shape it could not report', () => {
    const history = [
      { verb: 'claim' }, { verb: 'start' }, { verb: 'close' }, { verb: 'release' },
      { verb: 'claim' }, { verb: 'start' }, { verb: 'release' },
    ];
    expect(isStuckTicket({ status: 'ready', history })).toBe(true);
  });

  it('an ACCEPTED ticket is still finished — accept keeps disqualifying', () => {
    const history = [
      { verb: 'claim' }, { verb: 'start' }, { verb: 'close' }, { verb: 'accept' },
      { verb: 'release' }, { verb: 'release' },
    ];
    expect(isStuckTicket({ status: 'ready', history })).toBe(false);
  });
});
