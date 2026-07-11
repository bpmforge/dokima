import { describe, expect, it } from 'vitest';
import { matchesAnyGlob, matchesGlob } from './glob.js';

describe('matchesGlob', () => {
  it('matches everything under a directory with a trailing **', () => {
    expect(matchesGlob('packages/git/src/index.ts', 'packages/git/**')).toBe(true);
    expect(matchesGlob('packages/git/src/nested/deep.ts', 'packages/git/**')).toBe(true);
  });

  it('does not match outside the directory', () => {
    expect(matchesGlob('packages/events/src/index.ts', 'packages/git/**')).toBe(false);
    expect(matchesGlob('packages/git-other/index.ts', 'packages/git/**')).toBe(false);
  });

  it('matches a single-segment prefix glob without crossing a slash', () => {
    expect(
      matchesGlob('packages/events/src/receipts.ts', 'packages/events/src/receipts*'),
    ).toBe(true);
    expect(
      matchesGlob(
        'packages/events/src/receipts.test.ts',
        'packages/events/src/receipts*',
      ),
    ).toBe(true);
    expect(
      matchesGlob(
        'packages/events/src/receipts/nested.ts',
        'packages/events/src/receipts*',
      ),
    ).toBe(false);
  });

  it('escapes regexp-special characters literally', () => {
    expect(matchesGlob('packages/git/a.b(c).ts', 'packages/git/**')).toBe(true);
  });
});

describe('matchesAnyGlob', () => {
  it('is true if any pattern matches', () => {
    expect(
      matchesAnyGlob('packages/git/src/index.ts', [
        'packages/shared/**',
        'packages/git/**',
      ]),
    ).toBe(true);
  });

  it('is false if no pattern matches', () => {
    expect(
      matchesAnyGlob('packages/git/src/index.ts', [
        'packages/shared/**',
        'packages/events/**',
      ]),
    ).toBe(false);
  });
});
