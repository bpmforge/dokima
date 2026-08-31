// longtail.test.ts — P3-05 AC3: the B-1 wave generator emits every named
// class as a tagged board row; longTailGaps flags a wave-less board.

import { describe, expect, it } from 'vitest';
import { generateLongTailWave, LONG_TAIL_CLASSES, longTailGaps } from './longtail.js';
import type { BoardTicketRow } from './types.js';

describe('generateLongTailWave', () => {
  const wave = generateLongTailWave('P9');

  it('emits all six named classes, in order', () => {
    expect(wave.map((t) => t.long_tail_class)).toEqual([
      'first-run-empty-db',
      'empty-states',
      'expired-session',
      'declared-error-paths',
      'migration-from-previous',
      'reset-uninstall',
    ]);
    expect(LONG_TAIL_CLASSES).toHaveLength(6);
  });

  it('every row is board-shaped, tagged long_tail: true, todo, prefixed id', () => {
    for (const row of wave) {
      expect(row.long_tail).toBe(true);
      expect(row.status).toBe('todo');
      expect(row.lane).toBe('long-tail');
      expect(row.points).toBe(1);
      expect(row.id).toMatch(/^P9-LT-\d{2}$/);
      expect(row.acceptance.length).toBeGreaterThan(0);
      expect(Array.isArray(row.write_scope)).toBe(true);
    }
    expect(new Set(wave.map((t) => t.id)).size).toBe(wave.length);
  });
});

describe('longTailGaps', () => {
  const plain: BoardTicketRow = {
    id: 'P1-01',
    title: 'feature',
    lane: 'packages',
    write_scope: [],
    acceptance: [],
    points: 3,
    status: 'done',
  };

  it('RED: a board with no long_tail-tagged ticket reports the missing wave', () => {
    const gaps = longTailGaps([plain]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.kind).toBe('no-long-tail-wave');
  });

  it('a board carrying a generated wave has no gap', () => {
    expect(longTailGaps([plain, ...generateLongTailWave('P9')])).toEqual([]);
  });
});
