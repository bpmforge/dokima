import { describe, expect, it } from 'vitest';
import { buildRepoMapSkeleton } from './repo-map.js';

describe('buildRepoMapSkeleton', () => {
  it('dedupes and sorts paths deterministically', () => {
    const result = buildRepoMapSkeleton(['b.ts', 'a.ts', 'a.ts', 'c.ts']);
    expect(result).toBe('REPO MAP:\n  a.ts\n  b.ts\n  c.ts');
  });

  it('is byte-identical across repeated calls with the same input (stable-prefix ordering)', () => {
    const paths = ['src/z.ts', 'src/a.ts', 'src/m.ts'];
    expect(buildRepoMapSkeleton(paths)).toBe(buildRepoMapSkeleton([...paths]));
  });

  it('is order-independent — the same path set renders the same skeleton regardless of input order', () => {
    const forward = buildRepoMapSkeleton(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const shuffled = buildRepoMapSkeleton(['src/c.ts', 'src/a.ts', 'src/b.ts']);
    expect(forward).toBe(shuffled);
  });

  it('truncates past maxEntries and reports how many were dropped', () => {
    const paths = Array.from({ length: 5 }, (_, i) => `src/f${i}.ts`);
    const result = buildRepoMapSkeleton(paths, { maxEntries: 3 });
    expect(result).toContain('...and 2 more paths (truncated for budget)');
    expect(result.split('\n')).toHaveLength(5); // header + 3 shown + truncation note
  });
});
