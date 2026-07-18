import { describe, expect, it } from 'vitest';
import { diffLines, diffStat } from './diff.js';

describe('diffLines', () => {
  it('returns all-equal for identical text', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines.every((l) => l.kind === 'equal')).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it('detects a single changed line as remove+add', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc');
    expect(lines).toEqual([
      { kind: 'equal', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'remove', oldLine: 2, text: 'b' },
      { kind: 'add', newLine: 2, text: 'x' },
      { kind: 'equal', oldLine: 3, newLine: 3, text: 'c' },
    ]);
  });

  it('detects a pure insertion', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { kind: 'equal', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'add', newLine: 2, text: 'b' },
      { kind: 'equal', oldLine: 2, newLine: 3, text: 'c' },
    ]);
  });

  it('detects a pure deletion', () => {
    const lines = diffLines('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { kind: 'equal', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'remove', oldLine: 2, text: 'b' },
      { kind: 'equal', oldLine: 3, newLine: 2, text: 'c' },
    ]);
  });

  it('handles empty old text (whole doc is an addition)', () => {
    const lines = diffLines('', 'a\nb');
    expect(lines.filter((l) => l.kind === 'add')).toHaveLength(2);
  });
});

describe('diffStat', () => {
  it('counts added and removed lines', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc\nd');
    const stat = diffStat(lines);
    expect(stat.removed).toBe(1);
    expect(stat.added).toBe(2);
  });
});
