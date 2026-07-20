/**
 * Hybrid retrieval + token-budgeted context assembly (FR-M1, US-604).
 * BM25 (via `facts_fts`) is the baseline candidate search — always
 * available, no local model required (AC-1: full retrieval suite passes
 * with embeddings disabled). When an `EmbeddingProvider` is supplied and
 * returns a real vector for both the query and a candidate fact, cosine
 * similarity re-ranks within that BM25-retrieved candidate pool (dense
 * re-rank over a sparse candidate set — never the reverse, since a fact
 * BM25 can't find at all is never surfaced regardless of embedding
 * similarity). `assembleContext` then trims the ranked list to a strict
 * token budget (AC-2), never assembling more than the caller can afford.
 */
import type { EmbeddingProvider } from './embeddings.js';
import { bufferToFloats, cosineSimilarity } from './embeddings.js';
import type { FactKind, FactRecord } from './facts.js';
import { touchFactUsage } from './facts.js';
import type { SqliteHandle } from './handle.js';
import { estimateTokens } from './tokens.js';

interface FactSearchRow {
  id: number;
  kind: string;
  content: string;
  source: string | null;
  confidence: number;
  verified: number;
  ticket_id: string | null;
  phase: string | null;
  embedding: Buffer | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  decayed: number;
  bm25_rank: number;
}

function toFactRecord(row: FactSearchRow): FactRecord {
  return {
    id: row.id,
    kind: row.kind as FactKind,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    verified: row.verified === 1,
    ticketId: row.ticket_id,
    phase: row.phase,
    embedding: row.embedding,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    decayed: row.decayed === 1,
  };
}

/** Splits free text into FTS5-safe literal tokens (no bare operators/quotes reach the query). */
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

export interface BM25SearchResult {
  readonly fact: FactRecord;
  /** BM25 rank as returned by SQLite (more negative = better match). */
  readonly bm25Rank: number;
}

export interface SearchFactsOptions {
  readonly kind?: FactKind;
  readonly ticketId?: string;
  readonly limit?: number;
}

const DEFAULT_CANDIDATE_LIMIT = 20;

/** BM25 candidate search over verified, non-decayed facts (FR-M1 baseline). */
export function searchFactsBm25(
  handle: SqliteHandle,
  query: string,
  options: SearchFactsOptions = {},
): BM25SearchResult[] {
  const matchQuery = toMatchQuery(query);
  if (matchQuery === null) {
    return [];
  }
  const clauses = ['facts_fts MATCH ?', 'f.verified = 1', 'f.decayed = 0'];
  const params: unknown[] = [matchQuery];
  if (options.kind) {
    clauses.push('f.kind = ?');
    params.push(options.kind);
  }
  if (options.ticketId) {
    clauses.push('f.ticket_id = ?');
    params.push(options.ticketId);
  }
  params.push(options.limit ?? DEFAULT_CANDIDATE_LIMIT);
  const rows = handle
    .prepare<FactSearchRow>(
      `SELECT f.*, bm25(facts_fts) AS bm25_rank
       FROM facts_fts
       JOIN facts f ON f.id = facts_fts.rowid
       WHERE ${clauses.join(' AND ')}
       ORDER BY bm25_rank ASC
       LIMIT ?`,
    )
    .all(...params);
  return rows.map((row) => ({ fact: toFactRecord(row), bm25Rank: row.bm25_rank }));
}

export interface AssembledFact {
  readonly fact: FactRecord;
  readonly score: number;
  readonly tokens: number;
}

export interface AssembledContext {
  readonly facts: readonly AssembledFact[];
  readonly totalTokens: number;
  /** Candidates that scored but didn't fit the budget — never silently vanish. */
  readonly droppedForBudget: number;
}

export interface AssembleContextOptions extends SearchFactsOptions {
  readonly tokenBudget: number;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly now?: () => string;
  /** Whether to bump use_count/last_used_at on facts that made the cut. Default true. */
  readonly touchUsage?: boolean;
}

/**
 * BM25 search -> optional embedding re-rank -> strict token-budget trim.
 * AC-1: with no embeddingProvider (or one that returns null), this is pure
 * BM25 ordering. AC-2: `totalTokens` for the returned facts never exceeds
 * `tokenBudget`.
 */
export async function assembleContext(
  handle: SqliteHandle,
  query: string,
  options: AssembleContextOptions,
): Promise<AssembledContext> {
  const candidates = searchFactsBm25(handle, query, options);

  let scored: AssembledFact[];
  const queryVector = options.embeddingProvider
    ? await options.embeddingProvider.embed(query)
    : null;
  if (queryVector) {
    const withSimilarity = await Promise.all(
      candidates.map(async (candidate) => {
        const factVector = candidate.fact.embedding
          ? bufferToFloats(candidate.fact.embedding)
          : null;
        const similarity =
          factVector && factVector.length === queryVector.length
            ? cosineSimilarity(queryVector, factVector)
            : null;
        return { candidate, similarity };
      }),
    );
    scored = withSimilarity
      .sort((a, b) => {
        // Facts with a real embedding similarity sort by it (best first);
        // facts without one keep their BM25 order, placed after any embedded match.
        if (a.similarity !== null && b.similarity !== null) {
          return b.similarity - a.similarity;
        }
        if (a.similarity !== null) return -1;
        if (b.similarity !== null) return 1;
        return a.candidate.bm25Rank - b.candidate.bm25Rank;
      })
      .map(({ candidate, similarity }) => ({
        fact: candidate.fact,
        score: similarity ?? -candidate.bm25Rank,
        tokens: estimateTokens(candidate.fact.content),
      }));
  } else {
    scored = candidates.map((candidate) => ({
      fact: candidate.fact,
      score: -candidate.bm25Rank,
      tokens: estimateTokens(candidate.fact.content),
    }));
  }

  const included: AssembledFact[] = [];
  let totalTokens = 0;
  let droppedForBudget = 0;
  for (const item of scored) {
    if (totalTokens + item.tokens > options.tokenBudget) {
      droppedForBudget += 1;
      continue;
    }
    included.push(item);
    totalTokens += item.tokens;
  }

  const touchUsage = options.touchUsage ?? true;
  if (touchUsage) {
    const now = options.now ?? (() => new Date().toISOString());
    for (const item of included) {
      touchFactUsage(handle, item.fact.id, now);
    }
  }

  return { facts: included, totalTokens, droppedForBudget };
}
