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

  it('carries all five OPERATIONS.md classes and invents no sixth', () => {
    const out = orderFounderQueue(
      FOUNDER_ITEM_CLASSES.map((kind, i) => item({ id: `k-${i}`, kind })),
    );
    expect(new Set(out.map((o) => o.kind))).toEqual(new Set(FOUNDER_ITEM_CLASSES));
    expect(FOUNDER_ITEM_CLASSES).toHaveLength(5);
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
