import { describe, expect, it } from 'vitest';
import { computeRank, computeStalenessDays, rankItems } from './ranking.js';
import type { PlanItemRecord } from './types.js';

function item(
  overrides: Partial<PlanItemRecord> & Pick<PlanItemRecord, 'id' | 'catalogId'>,
): PlanItemRecord {
  return {
    rank: 0,
    state: 'proposed',
    ticketId: null,
    verifyCriterion: 'x == 0',
    recommendation: 'fix x',
    severity: 1,
    leverage: 1,
    lastVerifiedAt: null,
    evidence: {},
    createdAt: '2026-07-18T00:00:00.000Z',
    firstSeenAt: '2026-07-18T00:00:00.000Z',
    attempt: 0,
    ...overrides,
  };
}

describe('computeStalenessDays', () => {
  it('floors at 1 for a brand-new item (same instant)', () => {
    expect(
      computeStalenessDays('2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
    ).toBe(1);
  });

  it('grows with elapsed days', () => {
    expect(
      computeStalenessDays('2026-07-18T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
    ).toBe(3);
  });

  it('floors at 1 under clock skew (asOf before firstSeenAt)', () => {
    expect(
      computeStalenessDays('2026-07-20T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
    ).toBe(1);
  });

  it('throws on an unparseable timestamp', () => {
    expect(() => computeStalenessDays('not-a-date', '2026-07-18T00:00:00.000Z')).toThrow(
      RangeError,
    );
  });
});

describe('computeRank', () => {
  it('multiplies severity x leverage x staleness', () => {
    expect(computeRank(3, 2, 4)).toBe(24);
  });
});

describe('rankItems', () => {
  const asOf = '2026-07-25T00:00:00.000Z'; // 7 days after createdAt/firstSeenAt below

  it('sorts descending by computed rank', () => {
    const items = [
      item({ id: 'A', catalogId: 'PC-001', severity: 1, leverage: 1 }), // rank = 1*1*8=8
      item({ id: 'B', catalogId: 'PC-002', severity: 5, leverage: 5 }), // rank = 5*5*8=200
      item({ id: 'C', catalogId: 'PC-003', severity: 2, leverage: 2 }), // rank = 2*2*8=32
    ];
    const ranked = rankItems(items, asOf);
    expect(ranked.map((r) => r.id)).toEqual(['B', 'C', 'A']);
    expect(ranked.map((r) => r.rank)).toEqual([200, 32, 8]);
  });

  it('breaks rank ties deterministically by catalogId then id', () => {
    const items = [
      item({ id: 'Z', catalogId: 'PC-002', severity: 2, leverage: 2 }),
      item({ id: 'A', catalogId: 'PC-001', severity: 2, leverage: 2 }),
      item({ id: 'B', catalogId: 'PC-001', severity: 2, leverage: 2 }),
    ];
    const ranked = rankItems(items, asOf);
    expect(ranked.map((r) => r.id)).toEqual(['A', 'B', 'Z']);
  });

  it('is deterministic: re-ranking the same input twice yields identical output', () => {
    const items = [
      item({ id: 'A', catalogId: 'PC-001', severity: 3, leverage: 2 }),
      item({ id: 'B', catalogId: 'PC-002', severity: 1, leverage: 4 }),
    ];
    const first = JSON.stringify(rankItems(items, asOf));
    const second = JSON.stringify(rankItems(items, asOf));
    expect(first).toBe(second);
  });

  it('does not mutate the input array', () => {
    const items = [
      item({ id: 'A', catalogId: 'PC-001', severity: 1, leverage: 1 }),
      item({ id: 'B', catalogId: 'PC-002', severity: 5, leverage: 5 }),
    ];
    const before = items.map((i) => i.id);
    rankItems(items, asOf);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});
