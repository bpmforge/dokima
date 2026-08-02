import type { TicketDraftInput } from './types.js';

/**
 * write_scope glob-overlap detector — duplicated (not imported, see types.ts
 * header) from `@dokima/shared`'s `glob/overlap.ts`: `*` = single path
 * segment run, `**` = zero or more full segments, `?` = one non-slash char.
 */
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

/** True iff some file path could match both write_scope globs. */
export function globOverlaps(patternA: string, patternB: string): boolean {
  return segmentListOverlaps(patternA.split('/'), patternB.split('/'));
}

/** True iff any glob in `a` overlaps any glob in `b`. */
export function writeScopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((patternA) => b.some((patternB) => globOverlaps(patternA, patternB)));
}

/**
 * FR-T3/BLUEPRINT §4 step 4: "lanes are derived from write-scope
 * disjointness" — never assigned by guess. Two tickets whose write_scope
 * overlaps MUST end up in the same lane (cross-lane overlap is a schema
 * error per W0-04's `validateLaneWriteScopes`), so lanes are exactly the
 * connected components of the overlap graph. Deterministic: lane name is
 * the lexicographically smallest ticket id in the component.
 */
export function deriveLanes(
  tickets: readonly TicketDraftInput[],
): ReadonlyMap<string, string> {
  const parent = new Map<string, string>();
  for (const t of tickets) parent.set(t.id, t.id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) {
      const next = parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    let cur = id;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur);
      if (next === undefined) break;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    // Deterministic merge target: keep the lexicographically smaller root,
    // independent of input/iteration order.
    if (rootA < rootB) parent.set(rootB, rootA);
    else parent.set(rootA, rootB);
  }

  for (let i = 0; i < tickets.length; i += 1) {
    for (let j = i + 1; j < tickets.length; j += 1) {
      const a = tickets[i];
      const b = tickets[j];
      if (!a || !b) continue;
      if (writeScopesOverlap(a.writeScope, b.writeScope)) union(a.id, b.id);
    }
  }

  const lanes = new Map<string, string>();
  for (const t of tickets) lanes.set(t.id, find(t.id));
  return lanes;
}
