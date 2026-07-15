/**
 * Overlap detector for the write_scope glob dialect (matcher.ts): `*` = single
 * path segment run, `**` = zero or more full segments, `?` = one non-slash
 * char. Canonical implementation (G-20) — git, loop, and tickets import this
 * instead of each hand-rolling (or hand-porting) the same segment DP.
 */

/** Does any string exist that both single-segment glob fragments could match? */
function segmentTextOverlaps(a: string, b: string): boolean {
  const memo = new Map<string, boolean>();
  function rec(i: number, j: number): boolean {
    const key = `${i},${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === a.length && j === b.length) {
      result = true;
    } else if (a[i] === '*') {
      result = rec(i + 1, j) || (j < b.length && rec(i, j + 1));
    } else if (b[j] === '*') {
      result = rec(i, j + 1) || (i < a.length && rec(i + 1, j));
    } else if (i < a.length && j < b.length) {
      const ac = a[i];
      const bc = b[j];
      result = (ac === bc || ac === '?' || bc === '?') && rec(i + 1, j + 1);
    } else {
      result = false;
    }
    memo.set(key, result);
    return result;
  }
  return rec(0, 0);
}

/** Does any sequence of path segments exist that both segment-lists could match, treating `**` as zero-or-more segments? */
function segmentListOverlaps(a: readonly string[], b: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  function rec(i: number, j: number): boolean {
    const key = `${i},${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === a.length && j === b.length) {
      result = true;
    } else if (a[i] === '**') {
      result = rec(i + 1, j) || (j < b.length && rec(i, j + 1));
    } else if (b[j] === '**') {
      result = rec(i, j + 1) || (i < a.length && rec(i + 1, j));
    } else if (i < a.length && j < b.length) {
      result = segmentTextOverlaps(a[i] ?? '', b[j] ?? '') && rec(i + 1, j + 1);
    } else {
      result = false;
    }
    memo.set(key, result);
    return result;
  }
  return rec(0, 0);
}

/** True iff some file path could match both write_scope globs (FR-T3). */
export function globOverlaps(patternA: string, patternB: string): boolean {
  return segmentListOverlaps(patternA.split('/'), patternB.split('/'));
}

/** True iff any glob in `a` overlaps any glob in `b`. */
export function writeScopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((patternA) => b.some((patternB) => globOverlaps(patternA, patternB)));
}
