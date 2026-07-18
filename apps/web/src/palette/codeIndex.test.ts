import { describe, expect, it } from 'vitest';
import { queryCodeIndex } from './codeIndex.js';

function fakeFetch(response: { ok: boolean; json?: () => Promise<unknown> }) {
  return async () => response as unknown as Response;
}

describe('queryCodeIndex (W7-06 honest degrade)', () => {
  it('returns null when the route 404s (W7-06 not built yet)', async () => {
    const result = await queryCodeIndex('p1', 'foo', {
      fetchImpl: fakeFetch({ ok: false }),
    });
    expect(result).toBeNull();
  });

  it('returns null on a network failure rather than throwing', async () => {
    const result = await queryCodeIndex('p1', 'foo', {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(result).toBeNull();
  });

  it('returns null when the body is malformed (no items array)', async () => {
    const result = await queryCodeIndex('p1', 'foo', {
      fetchImpl: fakeFetch({ ok: true, json: async () => ({}) }),
    });
    expect(result).toBeNull();
  });

  it('returns the ranked hits when the index is present', async () => {
    const hits = [{ path: 'src/x.ts', line: 12, snippet: 'function foo() {}' }];
    const result = await queryCodeIndex('p1', 'foo', {
      fetchImpl: fakeFetch({ ok: true, json: async () => ({ items: hits }) }),
    });
    expect(result).toEqual(hits);
  });
});
