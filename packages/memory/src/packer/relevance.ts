/**
 * Relevance-ranked file slices (BLUEPRINT §7.2 item 1, FR-L5): ranking
 * comes from the W7-06 code index's `codeSearch` (FR-M4) — never an ad-hoc
 * heuristic — then trimmed to a token budget by dropping whole low-ranked
 * slices, never truncating a slice's content mid-line. `codeSearch` is
 * queried with a generously large `topK` so the budget trim (not an
 * arbitrary result-count cap) decides what survives.
 */
import type { SqliteHandle } from '../store/handle.js';
import { codeSearch } from '../code-index/search.js';
import type { CodeSearchOptions } from '../code-index/search.js';
import { estimateTokens } from '../store/tokens.js';

export interface PackedSlice {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly score: number;
  readonly tokens: number;
}

export interface RankedSlicesResult {
  readonly slices: readonly PackedSlice[];
  readonly totalTokens: number;
  /** Ranked candidates that scored but didn't fit the remaining budget — never silently dropped uncounted. */
  readonly droppedForBudget: number;
}

const RELEVANCE_CANDIDATE_TOP_K = 100;

export async function rankFileSlices(
  handle: SqliteHandle,
  query: string,
  tokenBudget: number,
  options: CodeSearchOptions = {},
): Promise<RankedSlicesResult> {
  const results = await codeSearch(handle, query, {
    topK: RELEVANCE_CANDIDATE_TOP_K,
    ...options,
  });

  const slices: PackedSlice[] = [];
  let totalTokens = 0;
  let droppedForBudget = 0;
  for (const result of results) {
    const tokens = estimateTokens(result.content);
    if (totalTokens + tokens > tokenBudget) {
      droppedForBudget += 1;
      continue;
    }
    slices.push({ ...result, tokens });
    totalTokens += tokens;
  }

  return { slices, totalTokens, droppedForBudget };
}
