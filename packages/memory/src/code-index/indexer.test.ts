import { describe, expect, it } from 'vitest';
import { createTestHandle } from './test-helpers.js';
import { indexProject } from './indexer.js';
import { insertCodeChunk, listCodeChunksForPath } from './store.js';
import { searchCodeBm25 } from './search.js';
import { createInMemoryCodeIndexEventSink } from './events.js';
import type { ExecFileFn } from './ripgrep.js';
import type { CodeEmbeddingProvider } from './embeddings.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

function fakeFiles(files: readonly string[]): ExecFileFn {
  return () => Promise.resolve({ stdout: `${files.join('\n')}\n`, stderr: '' });
}

describe('indexProject', () => {
  it('reports rg unavailable and indexes nothing when the binary is missing', async () => {
    const handle = createTestHandle();
    const missing: ExecFileFn = () => {
      const error = new Error('spawn rg ENOENT') as Error & { code: string };
      error.code = 'ENOENT';
      return Promise.reject(error);
    };
    const result = await indexProject(handle, '/project', { execFileImpl: missing });
    expect(result).toEqual({
      filesIndexed: 0,
      chunksIndexed: 0,
      ripgrepUnavailable: true,
    });
  });

  it('chunks and stores every indexable file rg reports, skipping non-indexable extensions', async () => {
    const handle = createTestHandle();
    const contents = new Map([
      ['src/a.ts', 'export function frobnicate() { return 1; }'],
      ['README.md', '# hello'],
      ['image.png', 'binary-ish, should be skipped by extension filter'],
    ]);
    const result = await indexProject(handle, '/project', {
      execFileImpl: fakeFiles([...contents.keys()]),
      readFile: async (p) => {
        const rel = p.replace('/project/', '');
        const content = contents.get(rel);
        if (content === undefined) throw new Error(`unexpected read: ${p}`);
        return content;
      },
      now: NOW,
    });
    expect(result.ripgrepUnavailable).toBe(false);
    expect(result.filesIndexed).toBe(2);
    expect(result.chunksIndexed).toBe(2);
    expect(listCodeChunksForPath(handle, 'src/a.ts')).toHaveLength(1);
    expect(searchCodeBm25(handle, 'frobnicate')).toHaveLength(1);
  });

  it('re-indexing a path replaces its old chunks rather than accumulating them', async () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      {
        path: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        content: 'stale content, should vanish',
      },
      NOW,
    );
    await indexProject(handle, '/project', {
      execFileImpl: fakeFiles(['src/a.ts']),
      readFile: async () => 'export function freshExport() {}',
      now: NOW,
    });
    const chunks = listCodeChunksForPath(handle, 'src/a.ts');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('export function freshExport() {}');
  });

  it('tags each chunk with the embedding provider id when a provider is configured', async () => {
    const handle = createTestHandle();
    const provider: CodeEmbeddingProvider = {
      providerId: 'local-v1',
      embed: async () => new Float32Array([1, 2, 3]),
    };
    await indexProject(handle, '/project', {
      execFileImpl: fakeFiles(['src/a.ts']),
      readFile: async () => 'export function frobnicate() {}',
      embeddingProvider: provider,
      now: NOW,
    });
    const chunks = listCodeChunksForPath(handle, 'src/a.ts');
    expect(chunks[0]?.embedProvider).toBe('local-v1');
    expect(chunks[0]?.embedding).not.toBeNull();
  });

  it('skips a file that fails to read instead of failing the whole run', async () => {
    const handle = createTestHandle();
    const result = await indexProject(handle, '/project', {
      execFileImpl: fakeFiles(['src/a.ts', 'src/unreadable.ts']),
      readFile: async (p) => {
        if (p.endsWith('unreadable.ts')) throw new Error('EACCES');
        return 'export function ok() {}';
      },
      now: NOW,
    });
    expect(result.filesIndexed).toBe(1);
  });

  it('emits exactly one code_index.indexed event summarizing the run', async () => {
    const handle = createTestHandle();
    const sink = createInMemoryCodeIndexEventSink();
    const result = await indexProject(handle, '/project', {
      execFileImpl: fakeFiles(['src/a.ts']),
      readFile: async () => 'export function ok() {}',
      now: NOW,
      sink,
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toEqual({
      type: 'code_index.indexed',
      occurredAt: NOW(),
      detail: { rootDir: '/project', ...result },
    });
  });

  it('emits code_index.indexed even when rg is unavailable', async () => {
    const handle = createTestHandle();
    const sink = createInMemoryCodeIndexEventSink();
    const missing: ExecFileFn = () => {
      const error = new Error('spawn rg ENOENT') as Error & { code: string };
      error.code = 'ENOENT';
      return Promise.reject(error);
    };
    await indexProject(handle, '/project', { execFileImpl: missing, now: NOW, sink });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.type).toBe('code_index.indexed');
    expect(sink.events[0]?.detail).toMatchObject({ ripgrepUnavailable: true });
  });
});
