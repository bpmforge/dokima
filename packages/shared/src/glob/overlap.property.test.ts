import { describe, expect, it } from 'vitest';
import { matchesGlob } from './matcher.js';
import { globOverlaps } from './overlap.js';

/**
 * Deterministic PRNG (mulberry32) — `packages/shared/package.json` is
 * outside this ticket's write_scope, so this module can't add `fast-check`
 * (only git/loop/tickets get that dependency edit, per plan.json). A seeded
 * generator gives the same "arbitrary pattern pairs, generated paths"
 * property-test shape without a new dependency, and reproducible failures.
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

const rand = mulberry32(0xc0ffee);
const ALPHABET = ['a', 'b', 'c'] as const;

function randInt(max: number): number {
  return Math.floor(rand() * max);
}

function randSegment(): string {
  return ALPHABET[randInt(ALPHABET.length)] as string;
}

function randConcretePath(minLen = 1, maxLen = 5): string[] {
  const len = minLen + randInt(maxLen - minLen + 1);
  return Array.from({ length: len }, () => randSegment());
}

/**
 * Wildcard one glob out of a concrete path — the resulting pattern is still
 * matched by the origin path, so the origin path is an explicit witness for
 * any pair of patterns derived from it this way.
 */
function wildcardify(pathSegments: readonly string[]): string {
  const segments = [...pathSegments];
  const i = randInt(segments.length);
  const mode = randInt(3);
  if (mode === 0) {
    segments[i] = '*';
  } else if (mode === 1) {
    return [...segments.slice(0, i + 1), '**'].join('/');
  } else {
    const seg = segments[i] ?? '';
    const cut = Math.max(1, Math.floor(seg.length / 2));
    segments[i] = `${seg.slice(0, cut)}*`;
  }
  return segments.join('/');
}

describe('overlap(a, b) agrees with an explicit witness path (matcher.ts cross-check)', () => {
  it('a concrete path that matches both derived patterns implies they overlap', () => {
    for (let run = 0; run < 200; run += 1) {
      const path = randConcretePath();
      const patternA = wildcardify(path);
      const patternB = wildcardify(path);
      const joined = path.join('/');
      // ground truth: the origin path is a witness matched by both patterns
      expect(matchesGlob(joined, patternA)).toBe(true);
      expect(matchesGlob(joined, patternB)).toBe(true);
      expect(globOverlaps(patternA, patternB)).toBe(true);
    }
  });
});

/**
 * Bounded ground-truth oracle: for a small closed alphabet, "does a witness
 * path exist matched by both patterns" is decidable by brute-force
 * enumeration up to a length bound — any witness for globs built from at
 * most `MAX_SEGMENTS` each never needs a longer common path, since every
 * alignment step in the overlap DP either consumes one segment from each
 * pattern or lets a `**` absorb one extra segment from the other side.
 */
const MAX_SEGMENTS = 3;
const WITNESS_BOUND = MAX_SEGMENTS * 2;

function enumeratePaths(alphabet: readonly string[], maxSegments: number): string[] {
  const paths: string[] = [];
  function build(current: string[], remaining: number): void {
    paths.push(current.join('/'));
    if (remaining === 0) return;
    for (const seg of alphabet) {
      build([...current, seg], remaining - 1);
    }
  }
  build([], maxSegments);
  return paths;
}

const CANDIDATE_PATHS = enumeratePaths(ALPHABET, WITNESS_BOUND);

/**
 * `**` segments never appear adjacent in real write_scope patterns (it's a
 * redundant construct — `a/**\/**` means the same thing as `a/**`); excluding
 * it keeps the generator inside the dialect's actual vocabulary instead of
 * probing regex-compilation corners no real pattern exercises.
 */
function randPattern(): string {
  const len = 1 + randInt(MAX_SEGMENTS);
  const segments: string[] = [];
  for (let i = 0; i < len; i += 1) {
    const roll = randInt(5);
    let seg: string;
    if (roll === 0) seg = '*';
    else if (roll === 1) seg = '**';
    else seg = randSegment();
    if (seg === '**' && segments[segments.length - 1] === '**') seg = randSegment();
    segments.push(seg);
  }
  return segments.join('/');
}

describe('overlap(a, b) agrees with brute-force witness search over generated paths', () => {
  it('for arbitrary small-alphabet pattern pairs', () => {
    for (let run = 0; run < 300; run += 1) {
      const a = randPattern();
      const b = randPattern();
      const witnessExists = CANDIDATE_PATHS.some(
        (candidate) => matchesGlob(candidate, a) && matchesGlob(candidate, b),
      );
      expect(globOverlaps(a, b)).toBe(witnessExists);
    }
  });
});
