import { describe, expect, it } from 'vitest';
import { digestOf, stableStringify } from './digest.js';

describe('stableStringify', () => {
  it('sorts object keys so equivalent objects serialize identically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('sorts nested object keys recursively', () => {
    const left = { outer: { z: 1, a: { y: 2, b: 3 } } };
    const right = { outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe('digestOf', () => {
  it('is deterministic for the same logical value regardless of key order', () => {
    expect(digestOf({ command: 'ls', flags: ['-la'] })).toBe(
      digestOf({ flags: ['-la'], command: 'ls' }),
    );
  });

  it('differs for different values', () => {
    expect(digestOf({ command: 'ls' })).not.toBe(digestOf({ command: 'rm' }));
  });

  it('produces a 64-char hex sha256 digest', () => {
    expect(digestOf('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
