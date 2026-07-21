import { describe, expect, it } from 'vitest';
import { matchesPathFilter } from './path-filter.js';

describe('matchesPathFilter', () => {
  it('matches everything when no filter is given', () => {
    expect(matchesPathFilter('src/a.ts', undefined)).toBe(true);
    expect(matchesPathFilter('src/a.ts', null)).toBe(true);
    expect(matchesPathFilter('src/a.ts', '')).toBe(true);
  });

  it('treats a filter with no metacharacters as a directory prefix', () => {
    expect(matchesPathFilter('src/code-index/store.ts', 'src/code-index')).toBe(true);
    expect(matchesPathFilter('src/store/facts.ts', 'src/code-index')).toBe(false);
    expect(matchesPathFilter('src/code-index', 'src/code-index')).toBe(true);
  });

  it('matches `*` against a single path segment', () => {
    expect(matchesPathFilter('src/code-index/store.ts', 'src/*/store.ts')).toBe(true);
    expect(matchesPathFilter('src/a/b/store.ts', 'src/*/store.ts')).toBe(false);
  });

  it('matches `**` across path segments', () => {
    expect(matchesPathFilter('src/a/b/store.ts', 'src/**/store.ts')).toBe(true);
    expect(matchesPathFilter('src/store.ts', 'src/**/*.ts')).toBe(true);
  });

  it('does not match a path outside the glob', () => {
    expect(matchesPathFilter('apps/server/index.ts', 'packages/**')).toBe(false);
  });
});
