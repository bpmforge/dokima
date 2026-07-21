/**
 * `code_search(query, top_k, path_filter)` (FR-M4) — BM25 candidate search
 * over `code_chunks_fts` (same engine/shape as `store/retrieval.ts`'s
 * `searchFactsBm25`), optional provider-sticky embedding re-rank, then a
 * `path_filter` glob trim and `top_k` cap. Returned chunks always carry
 * file:line (`path`, `startLine`, `endLine`) so a caller can jump straight
 * to the source (US-604, and the Context Packer's FR-L5 ranking source).
 *
 * Provider-sticky (NFR-1): cosine similarity is only computed when a
 * candidate's `embedProvider` matches the query embedding's provider *and*
 * both vectors are present with matching length. Any mismatch — offline (no
 * provider configured), a different provider than what indexed the chunk,
 * or a chunk that was never embedded — falls back to that candidate's BM25
 * rank, never a cross-provider cosine comparison.
 */
import { bufferToFloats, cosineSimilarity } from './embeddings.js';
import type { CodeEmbeddingProvider } from './embeddings.js';
import { matchesPathFilter } from './path-filter.js';
import type { SqliteHandle } from '../store/handle.js';
import type { CodeChunkRecord } from './store.js';
import { toEmbeddingBuffer } from './store.js';

interface CodeChunkSearchRow {
  id: number;
  path: string;
  start_line: number;
  end_line: number;
  content: string;
  embedding: Buffer | null;
  embed_provider: string | null;
  indexed_at: string;
  bm25_rank: number;
}

function toRecord(row: CodeChunkSearchRow): CodeChunkRecord {
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

/** Splits free text into FTS5-safe literal tokens (mirrors store/retrieval.ts's toMatchQuery). */
function toMatchQuery(text: string): string | null {
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

export interface CodeChunkBm25Result {
  readonly chunk: CodeChunkRecord;
  readonly bm25Rank: number;
}

const BM25_CANDIDATE_LIMIT = 200;

/** BM25 candidate search over every indexed chunk (FR-M4 baseline, offline-safe). */
export function searchCodeBm25(
  handle: SqliteHandle,
  query: string,
): CodeChunkBm25Result[] {
  const matchQuery = toMatchQuery(query);
  if (matchQuery === null) {
    return [];
  }
  const rows = handle
    .prepare<CodeChunkSearchRow>(
      `SELECT c.*, bm25(code_chunks_fts) AS bm25_rank
       FROM code_chunks_fts
       JOIN code_chunks c ON c.id = code_chunks_fts.rowid
       WHERE code_chunks_fts MATCH ?
       ORDER BY bm25_rank ASC
       LIMIT ?`,
    )
    .all(matchQuery, BM25_CANDIDATE_LIMIT);
  return rows.map((row) => ({ chunk: toRecord(row), bm25Rank: row.bm25_rank }));
}

export interface CodeSearchResult {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly score: number;
}

export interface CodeSearchOptions {
  readonly topK?: number;
  readonly pathFilter?: string | null;
  readonly embeddingProvider?: CodeEmbeddingProvider;
}

const DEFAULT_TOP_K = 10;

export async function codeSearch(
  handle: SqliteHandle,
  query: string,
  options: CodeSearchOptions = {},
): Promise<CodeSearchResult[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const candidates = searchCodeBm25(handle, query).filter((candidate) =>
    matchesPathFilter(candidate.chunk.path, options.pathFilter),
  );

  const queryVector = options.embeddingProvider
    ? await options.embeddingProvider.embed(query)
    : null;
  const providerId = options.embeddingProvider?.providerId ?? null;

  let scored: Array<{ chunk: CodeChunkRecord; score: number }>;
  if (queryVector && providerId) {
    scored = candidates
      .map((candidate) => {
        const sameProvider = candidate.chunk.embedProvider === providerId;
        const factVector =
          sameProvider && candidate.chunk.embedding
            ? bufferToFloats(candidate.chunk.embedding)
            : null;
        const similarity =
          factVector && factVector.length === queryVector.length
            ? cosineSimilarity(queryVector, factVector)
            : null;
        return { candidate, similarity };
      })
      .sort((a, b) => {
        if (a.similarity !== null && b.similarity !== null) {
          return b.similarity - a.similarity;
        }
        if (a.similarity !== null) return -1;
        if (b.similarity !== null) return 1;
        return a.candidate.bm25Rank - b.candidate.bm25Rank;
      })
      .map(({ candidate, similarity }) => ({
        chunk: candidate.chunk,
        score: similarity ?? -candidate.bm25Rank,
      }));
  } else {
    scored = candidates.map((candidate) => ({
      chunk: candidate.chunk,
      score: -candidate.bm25Rank,
    }));
  }

  return scored.slice(0, topK).map(({ chunk, score }) => ({
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
    score,
  }));
}
