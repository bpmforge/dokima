import { describe, expect, it } from 'vitest';
import {
  bufferToFloats,
  cosineSimilarity,
  floatsToBuffer,
  NoopEmbeddingProvider,
} from './embeddings.js';

describe('NoopEmbeddingProvider', () => {
  it('is offline-honest: always returns null, never fabricates a vector', async () => {
    const provider = new NoopEmbeddingProvider();
    expect(await provider.embed('anything')).toBeNull();
  });
});

describe('float <-> buffer round-trip', () => {
  it('preserves values', () => {
    const original = new Float32Array([1, 2.5, -3.25, 0]);
    const buffer = floatsToBuffer(original);
    const restored = bufferToFloats(buffer);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(
      cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])),
    ).toBeCloseTo(0, 5);
  });

  it('is 0 when either vector has zero magnitude', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() =>
      cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2])),
    ).toThrow(RangeError);
  });
});
