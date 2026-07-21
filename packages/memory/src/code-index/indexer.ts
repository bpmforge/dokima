/**
 * Builds/refreshes the per-project code index (FR-M4). Walks the project
 * via `ripgrep.ts#listProjectFiles` (already `.gitignore`-aware), chunks
 * each file (`chunker.ts`), embeds each chunk with the caller-supplied
 * provider when one is configured (offline-honest: `NoopCodeEmbeddingProvider`
 * leaves `embedding`/`embedProvider` null, same as facts), and replaces any
 * previously indexed chunks for that path. Re-indexing a file is
 * delete-then-insert rather than a diff — simple and correct; nothing in
 * the acceptance criteria requires incremental chunk-level diffing.
 */
import { chunkText, type ChunkOptions } from './chunker.js';
import type { CodeEmbeddingProvider } from './embeddings.js';
import { NoopCodeEmbeddingProvider } from './embeddings.js';
import { floatsToBuffer } from '../store/embeddings.js';
import type { ExecFileFn } from './ripgrep.js';
import { listProjectFiles } from './ripgrep.js';
import type { SqliteHandle } from '../store/handle.js';
import { deleteCodeChunksForPath, insertCodeChunk } from './store.js';

const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cs',
  '.md',
  '.sql',
];

export interface IndexProjectOptions {
  readonly extensions?: readonly string[];
  readonly chunkOptions?: ChunkOptions;
  readonly embeddingProvider?: CodeEmbeddingProvider;
  readonly now?: () => string;
  readonly execFileImpl?: ExecFileFn;
  /** Injectable for tests; defaults to `node:fs/promises#readFile`. */
  readonly readFile?: (path: string) => Promise<string>;
}

export interface IndexProjectResult {
  readonly filesIndexed: number;
  readonly chunksIndexed: number;
  /** `true` when `rg` was unavailable and no indexing happened at all. */
  readonly ripgrepUnavailable: boolean;
}

function hasIndexableExtension(path: string, extensions: readonly string[]): boolean {
  return extensions.some((ext) => path.endsWith(ext));
}

async function defaultReadFile(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

/** Indexes (or reindexes) every matching file under `rootDir` into `handle`. */
export async function indexProject(
  handle: SqliteHandle,
  rootDir: string,
  options: IndexProjectOptions = {},
): Promise<IndexProjectResult> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const provider = options.embeddingProvider ?? new NoopCodeEmbeddingProvider();
  const now = options.now ?? (() => new Date().toISOString());
  const readFileImpl = options.readFile ?? defaultReadFile;

  const files = await listProjectFiles(rootDir, { execFileImpl: options.execFileImpl });
  if (files === null) {
    return { filesIndexed: 0, chunksIndexed: 0, ripgrepUnavailable: true };
  }

  let filesIndexed = 0;
  let chunksIndexed = 0;
  for (const relativePath of files) {
    if (!hasIndexableExtension(relativePath, extensions)) continue;
    const absolutePath = `${rootDir.replace(/\/$/, '')}/${relativePath}`;
    let content: string;
    try {
      content = await readFileImpl(absolutePath);
    } catch {
      continue;
    }

    deleteCodeChunksForPath(handle, relativePath);
    const chunks = chunkText(content, options.chunkOptions);
    for (const chunk of chunks) {
      const vector = await provider.embed(chunk.content);
      insertCodeChunk(
        handle,
        {
          path: relativePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          embedding: vector ? floatsToBuffer(vector) : null,
          embedProvider: vector ? provider.providerId : null,
        },
        now,
      );
      chunksIndexed += 1;
    }
    filesIndexed += 1;
  }

  return { filesIndexed, chunksIndexed, ripgrepUnavailable: false };
}
