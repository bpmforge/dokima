import { describe, expect, it } from 'vitest';
import { createTestHandle } from './test-helpers.js';
import { insertCodeChunk } from './store.js';
import { codeSearch, searchCodeBm25 } from './search.js';
import { floatsToBuffer } from '../store/embeddings.js';
import type { CodeEmbeddingProvider } from './embeddings.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

function seed(handle: ReturnType<typeof createTestHandle>) {
  insertCodeChunk(
    handle,
    {
      path: 'src/frobnicate.ts',
      startLine: 1,
      endLine: 10,
      content: 'export function frobnicate(x: number) { return x * 2; }',
    },
    NOW,
  );
  insertCodeChunk(
    handle,
    {
      path: 'src/other/unrelated.ts',
      startLine: 1,
      endLine: 10,
      content: 'export function unrelatedThing() { return 42; }',
    },
    NOW,
  );
}

describe('searchCodeBm25', () => {
  it('returns no candidates for a query with no tokens', () => {
    const handle = createTestHandle();
    seed(handle);
    expect(searchCodeBm25(handle, '   ')).toEqual([]);
  });

  it('finds chunks matching the query text', () => {
    const handle = createTestHandle();
    seed(handle);
    const results = searchCodeBm25(handle, 'frobnicate');
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk.path).toBe('src/frobnicate.ts');
  });
});

describe('codeSearch', () => {
  it('returns ranked chunks with file:line (FR-M4), pure BM25 with no embedding provider', async () => {
    const handle = createTestHandle();
    seed(handle);
    const results = await codeSearch(handle, 'frobnicate');
    expect(results).toEqual([
      {
        path: 'src/frobnicate.ts',
        startLine: 1,
        endLine: 10,
        content: 'export function frobnicate(x: number) { return x * 2; }',
        score: expect.any(Number),
      },
    ]);
  });

  it('caps results at topK', async () => {
    const handle = createTestHandle();
    for (let i = 0; i < 5; i += 1) {
      insertCodeChunk(
        handle,
        {
          path: `src/f${i}.ts`,
          startLine: 1,
          endLine: 5,
          content: 'export function shared() {}',
        },
        NOW,
      );
    }
    const results = await codeSearch(handle, 'shared', { topK: 2 });
    expect(results).toHaveLength(2);
  });

  it('applies pathFilter before topK truncation', async () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      {
        path: 'apps/server/shared.ts',
        startLine: 1,
        endLine: 5,
        content: 'export function shared() {}',
      },
      NOW,
    );
    insertCodeChunk(
      handle,
      {
        path: 'packages/memory/shared.ts',
        startLine: 1,
        endLine: 5,
        content: 'export function shared() {}',
      },
      NOW,
    );
    const results = await codeSearch(handle, 'shared', { pathFilter: 'packages/**' });
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('packages/memory/shared.ts');
  });

  it('re-ranks by cosine similarity when the embedding provider matches the chunk provider', async () => {
    const handle = createTestHandle();
    const closeVector = new Float32Array([1, 0, 0]);
    const farVector = new Float32Array([0, 1, 0]);
    insertCodeChunk(
      handle,
      {
        path: 'src/far.ts',
        startLine: 1,
        endLine: 5,
        content: 'shared token appears here too',
        embedding: floatsToBuffer(farVector),
        embedProvider: 'local-v1',
      },
      NOW,
    );
    insertCodeChunk(
      handle,
      {
        path: 'src/close.ts',
        startLine: 1,
        endLine: 5,
        content: 'shared token appears here as well',
        embedding: floatsToBuffer(closeVector),
        embedProvider: 'local-v1',
      },
      NOW,
    );
    const provider: CodeEmbeddingProvider = {
      providerId: 'local-v1',
      embed: async () => closeVector,
    };
    const results = await codeSearch(handle, 'shared token', {
      embeddingProvider: provider,
    });
    expect(results[0]?.path).toBe('src/close.ts');
  });

  it('falls back to BM25 order on provider mismatch (NFR-1) instead of comparing across providers', async () => {
    const handle = createTestHandle();
    const vector = new Float32Array([1, 0, 0]);
    insertCodeChunk(
      handle,
      {
        path: 'src/indexed-by-other-provider.ts',
        startLine: 1,
        endLine: 5,
        content: 'shared token content',
        embedding: floatsToBuffer(vector),
        embedProvider: 'remote-v2',
      },
      NOW,
    );
    const provider: CodeEmbeddingProvider = {
      providerId: 'local-v1',
      embed: async () => vector,
    };
    // Should not throw despite a provider mismatch, and still return the BM25 hit.
    const results = await codeSearch(handle, 'shared token', {
      embeddingProvider: provider,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('src/indexed-by-other-provider.ts');
  });

  it('falls back to BM25 order when the embedding provider is offline (embed returns null)', async () => {
    const handle = createTestHandle();
    seed(handle);
    const provider: CodeEmbeddingProvider = {
      providerId: 'local-v1',
      embed: async () => null,
    };
    const results = await codeSearch(handle, 'frobnicate', {
      embeddingProvider: provider,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('src/frobnicate.ts');
  });
});
