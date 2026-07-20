import { beforeEach, describe, expect, it } from 'vitest';
import { assembleContext, searchFactsBm25 } from './retrieval.js';
import { floatsToBuffer, type EmbeddingProvider } from './embeddings.js';
import { insertFact, markFactVerified } from './facts.js';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';
import { estimateTokens } from './tokens.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

function seedVerifiedFact(
  handle: SqliteHandle,
  content: string,
  extra: { ticketId?: string; embedding?: Buffer } = {},
) {
  const fact = insertFact(
    handle,
    {
      kind: 'fact',
      content,
      confidence: 0.9,
      ticketId: extra.ticketId,
      embedding: extra.embedding,
    },
    NOW,
  );
  markFactVerified(handle, fact.id);
  return fact;
}

describe('searchFactsBm25', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createTestHandle();
  });

  it('finds a verified fact by keyword match', () => {
    seedVerifiedFact(handle, 'ENOENT errors mean the directory does not exist yet');
    seedVerifiedFact(handle, 'the sky is blue on a clear day');
    const results = searchFactsBm25(handle, 'ENOENT directory');
    expect(results).toHaveLength(1);
    expect(results[0]?.fact.content).toContain('ENOENT');
  });

  it('excludes unverified facts (verified-before-stored)', () => {
    insertFact(
      handle,
      { kind: 'fact', content: 'unverified claim about widgets', confidence: 0.5 },
      NOW,
    );
    expect(searchFactsBm25(handle, 'widgets')).toHaveLength(0);
  });

  it('excludes decayed facts', () => {
    const fact = seedVerifiedFact(handle, 'decayed widget fact');
    handle.exec(`UPDATE facts SET decayed = 1 WHERE id = ${fact.id}`);
    expect(searchFactsBm25(handle, 'widget')).toHaveLength(0);
  });

  it('filters by kind and ticketId', () => {
    seedVerifiedFact(handle, 'scoped widget note', { ticketId: 'W7-01' });
    seedVerifiedFact(handle, 'unscoped widget note');
    expect(searchFactsBm25(handle, 'widget', { ticketId: 'W7-01' })).toHaveLength(1);
  });

  it('returns [] for a query with no usable tokens (pure punctuation)', () => {
    seedVerifiedFact(handle, 'anything at all');
    expect(searchFactsBm25(handle, '!!! --- ???')).toEqual([]);
  });

  it('does not choke on FTS5 operator characters in the query', () => {
    seedVerifiedFact(handle, 'quotes and dashes in queries are handled safely');
    expect(() => searchFactsBm25(handle, '"unterminated quote AND - OR *')).not.toThrow();
  });
});

describe('assembleContext (US-604 AC-1/AC-2)', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createTestHandle();
  });

  it('AC-1: BM25-only ordering when no embedding provider is supplied', async () => {
    seedVerifiedFact(handle, 'primary relevant match about caching bugs');
    seedVerifiedFact(handle, 'a second note that also mentions caching briefly');
    const result = await assembleContext(handle, 'caching bugs', {
      tokenBudget: 1000,
      now: NOW,
    });
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.droppedForBudget).toBe(0);
  });

  it('AC-2: never assembles more than the token budget', async () => {
    for (let i = 0; i < 10; i += 1) {
      seedVerifiedFact(
        handle,
        `budget test fact number ${i} about caching layers and eviction policy details`,
      );
    }
    const budget = 20;
    const result = await assembleContext(handle, 'caching', {
      tokenBudget: budget,
      now: NOW,
    });
    expect(result.totalTokens).toBeLessThanOrEqual(budget);
    for (const item of result.facts) {
      expect(item.tokens).toBe(estimateTokens(item.fact.content));
    }
  });

  it('AC-2: a budget too small for any single fact yields an empty, honest result', async () => {
    seedVerifiedFact(
      handle,
      'this content is long enough to exceed a tiny budget for sure',
    );
    const result = await assembleContext(handle, 'content', { tokenBudget: 1, now: NOW });
    expect(result.facts).toEqual([]);
    expect(result.totalTokens).toBe(0);
    expect(result.droppedForBudget).toBe(1);
  });

  it('touches usage (use_count/last_used_at) for facts included in the assembly', async () => {
    const fact = seedVerifiedFact(handle, 'usage tracked fact about deployments');
    await assembleContext(handle, 'deployments', { tokenBudget: 1000, now: NOW });
    const rows = handle
      .prepare<{ use_count: number; last_used_at: string | null }>(
        'SELECT use_count, last_used_at FROM facts WHERE id = ?',
      )
      .all(fact.id);
    expect(rows[0]?.use_count).toBe(1);
    expect(rows[0]?.last_used_at).toBe(NOW());
  });

  it('hybrid: an embedding provider re-ranks the BM25 candidate pool by similarity', async () => {
    const queryVector = new Float32Array([1, 0, 0]);
    const closeVector = new Float32Array([1, 0, 0]);
    const farVector = new Float32Array([0, 1, 0]);
    seedVerifiedFact(handle, 'topic match far vector caching note', {
      embedding: floatsToBuffer(farVector),
    });
    seedVerifiedFact(handle, 'topic match close vector caching note', {
      embedding: floatsToBuffer(closeVector),
    });
    const provider: EmbeddingProvider = {
      async embed(text) {
        return text === 'topic match' ? queryVector : null;
      },
    };
    const result = await assembleContext(handle, 'topic match', {
      tokenBudget: 1000,
      embeddingProvider: provider,
      now: NOW,
    });
    expect(result.facts[0]?.fact.content).toContain('close vector');
  });

  it('AC-1 (offline honesty): a NoopEmbeddingProvider-shaped provider that returns null falls back to BM25', async () => {
    seedVerifiedFact(handle, 'offline fallback fact about retries');
    const provider: EmbeddingProvider = {
      async embed() {
        return null;
      },
    };
    const result = await assembleContext(handle, 'retries', {
      tokenBudget: 1000,
      embeddingProvider: provider,
      now: NOW,
    });
    expect(result.facts).toHaveLength(1);
  });
});
