/**
 * CRUD for `code_chunks` (011_code_index.sql) — the storage layer `indexer.ts`
 * and `search.ts` build on, mirroring `store/facts.ts`'s shape for the same
 * table family. Operates on an already-open `SqliteHandle`; never opens a
 * connection itself (ARCHITECTURE §4 law 4).
 */
import type { SqliteHandle } from '../store/handle.js';

export interface CodeChunkRecord {
  readonly id: number;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly embedding: Buffer | null;
  readonly embedProvider: string | null;
  readonly indexedAt: string;
}

export interface InsertCodeChunkInput {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly embedding?: Buffer | null;
  readonly embedProvider?: string | null;
}

interface CodeChunkRow {
  id: number;
  path: string;
  start_line: number;
  end_line: number;
  content: string;
  embedding: Buffer | null;
  embed_provider: string | null;
  indexed_at: string;
}

/** node:sqlite hands BLOB columns back as Uint8Array, better-sqlite3 as Buffer — normalize to Buffer either way. */
export function toEmbeddingBuffer(value: Buffer | Uint8Array | null): Buffer | null {
  return value ? Buffer.from(value) : null;
}

function toRecord(row: CodeChunkRow): CodeChunkRecord {
  return {
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    embedding: toEmbeddingBuffer(row.embedding),
    embedProvider: row.embed_provider,
    indexedAt: row.indexed_at,
  };
}

export function insertCodeChunk(
  handle: SqliteHandle,
  input: InsertCodeChunkInput,
  now: () => string,
): CodeChunkRecord {
  const indexedAt = now();
  const result = handle
    .prepare(
      `INSERT INTO code_chunks (path, start_line, end_line, content, embedding, embed_provider, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.path,
      input.startLine,
      input.endLine,
      input.content,
      input.embedding ?? null,
      input.embedProvider ?? null,
      indexedAt,
    );
  return getCodeChunk(handle, Number(result.lastInsertRowid)) as CodeChunkRecord;
}

export function getCodeChunk(
  handle: SqliteHandle,
  id: number,
): CodeChunkRecord | undefined {
  const row = handle
    .prepare<CodeChunkRow>('SELECT * FROM code_chunks WHERE id = ?')
    .get(id);
  return row ? toRecord(row) : undefined;
}

/** Removes every chunk previously indexed for a path — the reindex-a-file primitive. */
export function deleteCodeChunksForPath(handle: SqliteHandle, path: string): void {
  handle.prepare('DELETE FROM code_chunks WHERE path = ?').run(path);
}

export function listCodeChunksForPath(
  handle: SqliteHandle,
  path: string,
): CodeChunkRecord[] {
  const rows = handle
    .prepare<CodeChunkRow>('SELECT * FROM code_chunks WHERE path = ? ORDER BY start_line')
    .all(path);
  return rows.map(toRecord);
}

export function countCodeChunks(handle: SqliteHandle): number {
  const row = handle
    .prepare<{ count: number }>('SELECT COUNT(*) AS count FROM code_chunks')
    .get();
  return row?.count ?? 0;
}
