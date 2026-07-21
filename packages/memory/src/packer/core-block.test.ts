import { describe, expect, it } from 'vitest';
import { buildCoreBlock, CORE_BLOCK_TOKEN_CEILING } from './core-block.js';

describe('buildCoreBlock', () => {
  it('joins sections and reports withinCeiling for a small core block', () => {
    const result = buildCoreBlock(['Project invariants.', 'Naming conventions.']);
    expect(result.text).toBe('Project invariants.\n\nNaming conventions.');
    expect(result.withinCeiling).toBe(true);
  });

  it('flags a core block over the 1k-token ceiling instead of truncating it', () => {
    // estimateTokens is chars/4, so 4001 chars = 1001 tokens, one over the ceiling.
    const oversized = 'x'.repeat(CORE_BLOCK_TOKEN_CEILING * 4 + 1);
    const result = buildCoreBlock([oversized]);
    expect(result.withinCeiling).toBe(false);
    expect(result.text).toBe(oversized); // never truncated, even when flagged
  });

  it('is exactly at the ceiling boundary when content is precisely 1k tokens', () => {
    const exact = 'x'.repeat(CORE_BLOCK_TOKEN_CEILING * 4);
    const result = buildCoreBlock([exact]);
    expect(result.tokens).toBe(CORE_BLOCK_TOKEN_CEILING);
    expect(result.withinCeiling).toBe(true);
  });
});
