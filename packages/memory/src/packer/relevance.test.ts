import { describe, expect, it } from 'vitest';
import { createTestHandle } from '../code-index/test-helpers.js';
import { insertCodeChunk } from '../code-index/store.js';
import { rankFileSlices } from './relevance.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('rankFileSlices', () => {
  it('ranks slices via the code index and never truncates a slice mid-content', async () => {
    const handle = createTestHandle();
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
    const result = await rankFileSlices(handle, 'frobnicate', 10_000);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]?.content).toBe(
      'export function frobnicate(x: number) { return x * 2; }',
    );
    expect(result.droppedForBudget).toBe(0);
  });

  it('drops whole low-ranked slices when the budget runs out, counting them honestly', async () => {
    const handle = createTestHandle();
    for (let i = 0; i < 5; i += 1) {
      insertCodeChunk(
        handle,
        {
          path: `src/f${i}.ts`,
          startLine: 1,
          endLine: 5,
          content: `export function shared() { return ${i}; }`,
        },
        NOW,
      );
    }
    // Budget for roughly one slice's worth of tokens.
    const oneSliceTokens = Math.ceil('export function shared() { return 0; }'.length / 4);
    const result = await rankFileSlices(handle, 'shared', oneSliceTokens);
    expect(result.slices.length).toBeGreaterThan(0);
    expect(result.slices.length).toBeLessThan(5);
    expect(result.droppedForBudget).toBe(5 - result.slices.length);
    expect(result.totalTokens).toBeLessThanOrEqual(oneSliceTokens);
  });

  it('returns nothing and drops nothing when no candidates match the query', async () => {
    const handle = createTestHandle();
    const result = await rankFileSlices(handle, 'nonexistentquery', 10_000);
    expect(result.slices).toEqual([]);
    expect(result.droppedForBudget).toBe(0);
  });

  it('respects a pathFilter passed through to codeSearch', async () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      {
        path: 'apps/server/shared.ts',
        startLine: 1,
        endLine: 5,
        content: 'shared thing',
      },
      NOW,
    );
    insertCodeChunk(
      handle,
      {
        path: 'packages/memory/shared.ts',
        startLine: 1,
        endLine: 5,
        content: 'shared thing',
      },
      NOW,
    );
    const result = await rankFileSlices(handle, 'shared', 10_000, {
      pathFilter: 'packages/**',
    });
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]?.path).toBe('packages/memory/shared.ts');
  });
});
