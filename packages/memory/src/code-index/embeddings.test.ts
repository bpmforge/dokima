import { describe, expect, it } from 'vitest';
import { NoopCodeEmbeddingProvider } from './embeddings.js';

describe('NoopCodeEmbeddingProvider', () => {
  it('is offline-honest: always returns null, never fabricates a vector', async () => {
    const provider = new NoopCodeEmbeddingProvider();
    expect(await provider.embed('anything')).toBeNull();
    expect(provider.providerId).toBe('noop');
  });
});
