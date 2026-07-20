import { describe, expect, it } from 'vitest';
import { estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
  it('rounds up chars/4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('is 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
