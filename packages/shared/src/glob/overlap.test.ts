import { describe, expect, it } from 'vitest';
import { globOverlaps, writeScopesOverlap } from './overlap.js';

describe('globOverlaps (FR-T3 glob-overlap detection)', () => {
  it('two identical literal paths overlap', () => {
    expect(
      globOverlaps('packages/tickets/src/lanes.ts', 'packages/tickets/src/lanes.ts'),
    ).toBe(true);
  });

  it('a `**` subtree glob overlaps a literal file beneath it', () => {
    expect(globOverlaps('packages/tickets/**', 'packages/tickets/src/lanes.ts')).toBe(
      true,
    );
    expect(globOverlaps('packages/tickets/src/lanes.ts', 'packages/tickets/**')).toBe(
      true,
    );
  });

  it('two `**` subtrees under different top-level dirs do not overlap', () => {
    expect(globOverlaps('apps/**', 'packages/**')).toBe(false);
  });

  it('prefix-star globs overlap only when the prefix matches', () => {
    expect(
      globOverlaps(
        'packages/tickets/src/lanes*',
        'packages/tickets/src/lanes.property.test.ts',
      ),
    ).toBe(true);
    expect(
      globOverlaps('packages/tickets/src/lanes*', 'packages/tickets/src/reflow.ts'),
    ).toBe(false);
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['packages/tickets/**', 'packages/tickets/src/lanes.ts'],
      ['apps/**', 'packages/**'],
      [
        'packages/gateway/src/providers/anthropic*',
        'packages/gateway/src/providers/openai*',
      ],
    ];
    for (const [a, b] of pairs) {
      expect(globOverlaps(a, b)).toBe(globOverlaps(b, a));
    }
  });
});

describe('writeScopesOverlap', () => {
  it('true when any pair of globs across the two lists overlaps', () => {
    expect(
      writeScopesOverlap(
        ['packages/tickets/src/lanes*', 'packages/tickets/src/reflow*'],
        ['packages/tickets/**'],
      ),
    ).toBe(true);
  });

  it('false when no pair overlaps', () => {
    expect(
      writeScopesOverlap(
        ['packages/tickets/src/lanes*'],
        ['packages/tickets/src/reflow*', 'packages/tickets/test/**'],
      ),
    ).toBe(false);
  });
});
