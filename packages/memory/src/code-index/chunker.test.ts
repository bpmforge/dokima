import { describe, expect, it } from 'vitest';
import { chunkText } from './chunker.js';

describe('chunkText', () => {
  it('returns no chunks for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns one chunk when the file fits within maxLines', () => {
    const text = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkText(text, { maxLines: 40, overlapLines: 5 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ startLine: 1, endLine: 5, content: text });
  });

  it('splits a large file into overlapping windows with correct 1-indexed line numbers', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const chunks = chunkText(lines.join('\n'), { maxLines: 40, overlapLines: 5 });
    // step = 35: windows start at 1, 36, 71
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([
      [1, 40],
      [36, 75],
      [71, 100],
    ]);
    expect(chunks[0]?.content.split('\n')).toHaveLength(40);
    // overlap: chunk 2 starts 5 lines before chunk 1 ends
    expect(chunks[1]?.content.split('\n')[0]).toBe('line 36');
  });

  it('never produces a phantom trailing empty line from a final newline', () => {
    const chunks = chunkText('a\nb\nc\n', { maxLines: 40, overlapLines: 5 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ startLine: 1, endLine: 3, content: 'a\nb\nc' });
  });

  it('clamps overlap below maxLines so the window always advances', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const chunks = chunkText(lines.join('\n'), { maxLines: 5, overlapLines: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1]?.endLine).toBe(20);
  });
});
