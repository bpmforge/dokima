import { describe, expect, it } from 'vitest';
import { pruneTurns } from './prune.js';

describe('pruneTurns', () => {
  it('drops failed-attempt turns entirely (distill-never-replay, R-I1/R-I2)', () => {
    const result = pruneTurns([
      { outcome: 'failed', summary: 'attempt 1: wrong file edited' },
      { outcome: 'success', summary: 'attempt 2: fixed the bug' },
    ]);
    expect(result).toEqual(['attempt 2: fixed the bug']);
  });

  it('replaces stale (non-failed) tool-result turns with a fixed marker', () => {
    const result = pruneTurns([
      { outcome: 'success', stale: true, summary: 'ls output from 3 revisions ago' },
    ]);
    expect(result).toEqual(['[pruned: stale tool result]']);
  });

  it('passes through fresh, successful turns verbatim', () => {
    const result = pruneTurns([
      { outcome: 'success', summary: 'ran the gate: 12 passed' },
    ]);
    expect(result).toEqual(['ran the gate: 12 passed']);
  });

  it('returns an empty list for no turns', () => {
    expect(pruneTurns([])).toEqual([]);
  });
});
