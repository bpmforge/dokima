/**
 * Error-first recall (FR-M3, US-602): "before a task class that previously
 * failed, the failure fact + fix inject first." This wraps
 * `store/retrieval.ts`'s `searchFactsBm25`/`assembleContext` — never
 * duplicates their token-budget or BM25/embedding-rerank logic — and
 * re-orders the resulting packet so a matching `error_solution` fact leads,
 * regardless of its raw relevance rank relative to other fact kinds. That
 * ordering is the acceptance sketch's literal claim ("packet ... leads with
 * the error->fix pair, order asserted"), not merely a side effect of
 * whatever BM25/cosine happens to score highest.
 *
 * `query` doubles as the task-class key, the same way `playbook/consult.ts`
 * normalizes a ticket's `criterion` into a task class for R0 lookup: this
 * function makes no schema change to `facts` (out of this ticket's
 * write_scope — `store/**` is a different ticket's), so "does this match a
 * previously-failed task class" is answered the same way ordinary recall
 * answers "does this match the current task" — via BM25 over `content`,
 * scoped to `kind = 'error_solution'` and, when given, the same `ticketId`
 * a task class recurs under.
 */
import { touchFactUsage } from '../store/facts.js';
import type { SqliteHandle } from '../store/handle.js';
import {
  assembleContext,
  searchFactsBm25,
  type AssembleContextOptions,
  type AssembledFact,
} from '../store/retrieval.js';
import { estimateTokens } from '../store/tokens.js';
import { noopConsolidationSink, type ConsolidationSink } from './events.js';

export interface ErrorFirstContextOptions extends AssembleContextOptions {
  readonly sink?: ConsolidationSink;
}

export interface ErrorFirstAssembledContext {
  readonly facts: readonly AssembledFact[];
  readonly totalTokens: number;
  readonly droppedForBudget: number;
  /** How many of `facts` (from the front) are the prioritized error->solution leads. */
  readonly errorFirstCount: number;
}

const ERROR_FIRST_CANDIDATE_LIMIT = 5;

/**
 * Assembles a token-budgeted packet with any matching `error_solution` fact
 * placed first. Falls back to plain `assembleContext` ordering when no
 * error-solution fact matches (an honest miss never fabricates a lead).
 */
export async function assembleErrorFirstContext(
  handle: SqliteHandle,
  query: string,
  options: ErrorFirstContextOptions,
): Promise<ErrorFirstAssembledContext> {
  const errorHits = searchFactsBm25(handle, query, {
    kind: 'error_solution',
    ticketId: options.ticketId,
    limit: ERROR_FIRST_CANDIDATE_LIMIT,
  });

  const general = await assembleContext(handle, query, { ...options, touchUsage: false });

  const included: AssembledFact[] = [];
  const seen = new Set<number>();
  let totalTokens = 0;
  let droppedForBudget = 0;

  for (const hit of errorHits) {
    const tokens = estimateTokens(hit.fact.content);
    if (totalTokens + tokens > options.tokenBudget) {
      droppedForBudget += 1;
      continue;
    }
    included.push({ fact: hit.fact, score: -hit.bm25Rank, tokens });
    seen.add(hit.fact.id);
    totalTokens += tokens;
  }
  const errorFirstCount = included.length;

  for (const item of general.facts) {
    if (seen.has(item.fact.id)) {
      continue;
    }
    if (totalTokens + item.tokens > options.tokenBudget) {
      droppedForBudget += 1;
      continue;
    }
    included.push(item);
    seen.add(item.fact.id);
    totalTokens += item.tokens;
  }
  droppedForBudget += general.droppedForBudget;

  const now = options.now ?? (() => new Date().toISOString());
  const touchUsage = options.touchUsage ?? true;
  if (touchUsage) {
    for (const item of included) {
      touchFactUsage(handle, item.fact.id, now);
    }
  }

  if (errorFirstCount > 0) {
    const sink = options.sink ?? noopConsolidationSink;
    void sink.emit({
      type: 'memory.error_first_recall',
      occurredAt: now(),
      detail: {
        ticketId: options.ticketId ?? null,
        query,
        errorFactIds: included.slice(0, errorFirstCount).map((item) => item.fact.id),
      },
    });
  }

  return { facts: included, totalTokens, droppedForBudget, errorFirstCount };
}
