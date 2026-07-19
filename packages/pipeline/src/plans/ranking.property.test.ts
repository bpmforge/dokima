import { describe, expect, it } from 'vitest';
import { computeRank, computeStalenessDays, rankItems } from './ranking.js';
import type { PlanItemRecord } from './types.js';

/**
 * `fast-check` is declared per-package (packages/events, packages/tickets)
 * and this ticket's write_scope does not include
 * `packages/pipeline/package.json` (same wall `../phases/types.ts`
 * documents: no declared workspace/dev dependency ⇒ no symlink in
 * `packages/pipeline/node_modules` ⇒ `tsc`/`vitest` can't resolve it —
 * confirmed empirically here the same way W5-01 confirmed it for
 * `@shipwright/*`). This hand-rolled seeded PRNG (mulberry32, deterministic
 * given a fixed seed — no `Math.random()`) gives the same property-testing
 * guarantee — many generated cases checked against an invariant, shrink-free
 * — without the dependency. A future ticket that DOES own package.json can
 * swap this for `fc.assert` with no change to the invariants below.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const ASOF = '2026-08-01T00:00:00.000Z';

function makeItem(
  id: string,
  catalogId: string,
  severity: number,
  leverage: number,
  firstSeenAt: string,
): PlanItemRecord {
  return {
    id,
    catalogId,
    rank: 0,
    state: 'proposed',
    ticketId: null,
    verifyCriterion: 'x == 0',
    recommendation: 'fix x',
    severity,
    leverage,
    lastVerifiedAt: null,
    evidence: {},
    createdAt: firstSeenAt,
    firstSeenAt,
    attempt: 0,
  };
}

function randomDateNear(rng: () => number): string {
  const days = randInt(rng, 0, 60);
  return new Date(Date.parse(ASOF) - days * 86_400_000).toISOString();
}

const TRIALS = 200;

describe('rankItems — property tests (severity x leverage x staleness)', () => {
  it("every item's rank equals severity x leverage x staleness, for TRIALS random item sets", () => {
    const rng = mulberry32(42);
    for (let trial = 0; trial < TRIALS; trial++) {
      const count = randInt(rng, 1, 8);
      const items: PlanItemRecord[] = [];
      for (let i = 0; i < count; i++) {
        const severity = randInt(rng, 1, 5);
        const leverage = randInt(rng, 1, 5);
        const firstSeenAt = randomDateNear(rng);
        items.push(
          makeItem(
            `item-${trial}-${i}`,
            `PC-${String(i).padStart(3, '0')}`,
            severity,
            leverage,
            firstSeenAt,
          ),
        );
      }
      const ranked = rankItems(items, ASOF);
      for (const r of ranked) {
        const expected = computeRank(
          r.severity,
          r.leverage,
          computeStalenessDays(r.firstSeenAt, ASOF),
        );
        expect(r.rank).toBe(expected);
      }
    }
  });

  it('output is sorted non-increasing by rank, for TRIALS random item sets', () => {
    const rng = mulberry32(1337);
    for (let trial = 0; trial < TRIALS; trial++) {
      const count = randInt(rng, 1, 10);
      const items: PlanItemRecord[] = [];
      for (let i = 0; i < count; i++) {
        items.push(
          makeItem(
            `item-${trial}-${i}`,
            `PC-${String(i).padStart(3, '0')}`,
            randInt(rng, 1, 5),
            randInt(rng, 1, 5),
            randomDateNear(rng),
          ),
        );
      }
      const ranked = rankItems(items, ASOF);
      for (let i = 1; i < ranked.length; i++) {
        const prev = ranked[i - 1];
        const curr = ranked[i];
        if (!prev || !curr) throw new Error('unreachable: index within bounds');
        expect(prev.rank).toBeGreaterThanOrEqual(curr.rank);
      }
    }
  });

  it('is deterministic: same input re-ranked twice is byte-identical, for TRIALS random item sets', () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < TRIALS; trial++) {
      const count = randInt(rng, 1, 6);
      const items: PlanItemRecord[] = [];
      for (let i = 0; i < count; i++) {
        items.push(
          makeItem(
            `item-${trial}-${i}`,
            `PC-${String(i).padStart(3, '0')}`,
            randInt(rng, 1, 5),
            randInt(rng, 1, 5),
            randomDateNear(rng),
          ),
        );
      }
      const first = JSON.stringify(rankItems(items, ASOF));
      const second = JSON.stringify(rankItems(items, ASOF));
      expect(first).toBe(second);
    }
  });

  it('increasing one factor (severity/leverage/staleness) never decreases rank, all else equal', () => {
    const rng = mulberry32(99);
    for (let trial = 0; trial < TRIALS; trial++) {
      const severity = randInt(rng, 1, 4);
      const leverage = randInt(rng, 1, 4);
      const staleness = randInt(rng, 1, 30);
      const base = computeRank(severity, leverage, staleness);
      expect(computeRank(severity + 1, leverage, staleness)).toBeGreaterThan(base);
      expect(computeRank(severity, leverage + 1, staleness)).toBeGreaterThan(base);
      expect(computeRank(severity, leverage, staleness + 1)).toBeGreaterThan(base);
    }
  });
});
