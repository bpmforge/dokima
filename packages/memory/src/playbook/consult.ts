/**
 * R0 consult (BLUEPRINT §3.3: "have we solved this before?", FR-M2): checks
 * the playbook first (exact task-class recurrence, the ACE-distilled
 * answer), then the fact bank (a verified error->solution/decision fact
 * scoped to this ticket) before any model call is made. Every consult emits
 * exactly one hit or miss event (`events.js`) — this is the memory layer's
 * own audit trail, independent of `packages/gateway`'s escalation-rung
 * events (which record ladder transitions, not memory answers).
 */
import { searchFactsBm25 } from '../store/retrieval.js';
import type { SqliteHandle } from '../store/handle.js';
import { noopPlaybookConsultSink, type PlaybookConsultSink } from './events.js';
import { getPlaybookHead, normalizePlaybookTaskClass } from './playbook.js';

export interface PlaybookConsultInput {
  readonly ticketId: string;
  /** The ONE checkable success criterion this ticket is being escalated toward (mirrors the micro-loop's CRITERION step). */
  readonly criterion: string;
}

export interface PlaybookConsultResult {
  /** True when a confirmed prior lesson (playbook or fact bank) answers the criterion outright. */
  readonly answered: boolean;
  readonly findingId?: string;
  readonly summary?: string;
}

export interface ConsultPlaybookOptions {
  readonly sink?: PlaybookConsultSink;
  readonly now?: () => string;
}

/**
 * Consults the playbook + fact bank for a confirmed answer to `criterion`.
 * Never fuzzy: a playbook hit requires an exact (normalized) task-class
 * match; a fact-bank hit requires a verified error->solution/decision fact
 * BM25-scoped to this exact `ticketId`. Anything else is an honest miss —
 * R0 can rescue a free pass, never fabricate one.
 */
export function consultPlaybook(
  handle: SqliteHandle,
  input: PlaybookConsultInput,
  options: ConsultPlaybookOptions = {},
): PlaybookConsultResult {
  const sink = options.sink ?? noopPlaybookConsultSink;
  const now = options.now ?? (() => new Date().toISOString());

  const taskClass = normalizePlaybookTaskClass(input.criterion);
  const head = getPlaybookHead(handle, taskClass);
  if (head) {
    const findingId = `playbook:${head.id}`;
    void sink.emit({
      type: 'playbook.r0_hit',
      ticketId: input.ticketId,
      criterion: input.criterion,
      source: 'playbook',
      findingId,
      occurredAt: now(),
    });
    return { answered: true, findingId, summary: head.entry };
  }

  const factHits = searchFactsBm25(handle, input.criterion, {
    ticketId: input.ticketId,
    limit: 1,
  }).filter(
    (hit) => hit.fact.kind === 'error_solution' || hit.fact.kind === 'decision_ref',
  );
  const fact = factHits[0]?.fact;
  if (fact) {
    const findingId = `fact:${fact.id}`;
    void sink.emit({
      type: 'playbook.r0_hit',
      ticketId: input.ticketId,
      criterion: input.criterion,
      source: 'fact',
      findingId,
      occurredAt: now(),
    });
    return { answered: true, findingId, summary: fact.content };
  }

  void sink.emit({
    type: 'playbook.r0_miss',
    ticketId: input.ticketId,
    criterion: input.criterion,
    occurredAt: now(),
  });
  return { answered: false };
}
