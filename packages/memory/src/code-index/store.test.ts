import { describe, expect, it } from 'vitest';
import { createTestHandle } from './test-helpers.js';
import {
  countCodeChunks,
  deleteCodeChunksForPath,
  getCodeChunk,
  insertCodeChunk,
  listCodeChunksForPath,
} from './store.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('code_chunks store', () => {
  it('inserts and reads back a chunk', () => {
    const handle = createTestHandle();
    const chunk = insertCodeChunk(
      handle,
      { path: 'src/a.ts', startLine: 1, endLine: 10, content: 'export const a = 1;' },
      NOW,
    );
    expect(chunk.path).toBe('src/a.ts');
    expect(chunk.startLine).toBe(1);
    expect(chunk.endLine).toBe(10);
    expect(chunk.embedding).toBeNull();
    expect(chunk.embedProvider).toBeNull();
    expect(chunk.indexedAt).toBe(NOW());
    expect(getCodeChunk(handle, chunk.id)).toEqual(chunk);
  });

  it('stores an embedding + provider id when given', () => {
    const handle = createTestHandle();
    const embedding = Buffer.from(new Float32Array([1, 2, 3]).buffer);
    const chunk = insertCodeChunk(
      handle,
      {
        path: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        content: 'x',
        embedding,
        embedProvider: 'local-v1',
      },
      NOW,
    );
    expect(chunk.embedding).toEqual(embedding);
    expect(chunk.embedProvider).toBe('local-v1');
  });

  it('lists chunks for a path ordered by start_line', () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      { path: 'src/a.ts', startLine: 41, endLine: 80, content: 'b' },
      NOW,
    );
    insertCodeChunk(
      handle,
      { path: 'src/a.ts', startLine: 1, endLine: 40, content: 'a' },
      NOW,
    );
    insertCodeChunk(
      handle,
      { path: 'src/b.ts', startLine: 1, endLine: 40, content: 'c' },
      NOW,
    );
    const chunks = listCodeChunksForPath(handle, 'src/a.ts');
    expect(chunks.map((c) => c.startLine)).toEqual([1, 41]);
  });

  it('deletes all chunks for a path (the reindex primitive)', () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      { path: 'src/a.ts', startLine: 1, endLine: 40, content: 'a' },
      NOW,
    );
    insertCodeChunk(
      handle,
      { path: 'src/a.ts', startLine: 41, endLine: 80, content: 'b' },
      NOW,
    );
    insertCodeChunk(
      handle,
      { path: 'src/b.ts', startLine: 1, endLine: 40, content: 'c' },
      NOW,
    );
    deleteCodeChunksForPath(handle, 'src/a.ts');
    expect(listCodeChunksForPath(handle, 'src/a.ts')).toHaveLength(0);
    expect(countCodeChunks(handle)).toBe(1);
  });
});
