/**
 * plan_items lifecycle (FR-PLAN2/3, DATABASE.md §5b, docs/design/
 * IMPROVEMENT_PLANS.md §2 state diagram):
 *
 *   [*] --> proposed        (catalog condition matches a fresh snapshot)
 *   proposed --> accepted   (human accepts; mints a board ticket)
 *   accepted --> in_progress (linked ticket claimed)
 *   accepted --> done       (verify criterion satisfied)
 *   in_progress --> done    (verify criterion satisfied)
 *   done --> regressed      (a later snapshot violates the verify criterion)
 *   regressed --> accepted  (re-accepted; attempt counter increments)
 *   proposed --> [*]        (dismissed — out of scope for this ticket's
 *                             engine surface; dismissal is a board-level
 *                             action the wiring ticket records as a ledger
 *                             entry, not a plan_items state)
 *
 * Pure reducer, like `../phases/advance.ts`: every function takes the
 * current record(s) and returns the next one(s) — persistence (writing the
 * `plan_items` table, appending `plan.item_*` events) is the orchestrator's
 * job (W5-15), outside this write_scope.
 */

import { evaluatePredicate } from './expr.js';
import { computeRank } from './ranking.js';
import type {
  BoardTicketDraft,
  CatalogMatch,
  PlanEvaluationSnapshot,
  PlanItemRecord,
} from './types.js';
import { PlanLifecycleError } from './types.js';

export interface ClockOptions {
  readonly now?: () => string;
}

/**
 * Reconciles fresh catalog matches against already-tracked items and
 * returns only the NEW `proposed` items (one per catalog entry — v1 keeps a
 * single active item per `catalogId`, matching the design doc's diagram of
 * one item per matched condition; a catalogId with an existing item in any
 * state is left alone here, including `regressed` — re-opening a regressed
 * item is a human `acceptItem` re-accept, not a fresh proposal). The
 * caller persists `created` alongside its existing rows.
 */
export function proposeFromMatches(
  matches: readonly CatalogMatch[],
  existingItems: readonly PlanItemRecord[],
  opts: ClockOptions = {},
): readonly PlanItemRecord[] {
  const now = opts.now ?? (() => new Date().toISOString());
  const existingCatalogIds = new Set(existingItems.map((i) => i.catalogId));
  const created: PlanItemRecord[] = [];
  for (const match of matches) {
    if (existingCatalogIds.has(match.catalogId)) continue;
    const timestamp = now();
    created.push({
      id: match.catalogId,
      catalogId: match.catalogId,
      rank: computeRank(match.severity, match.leverage, 1),
      state: 'proposed',
      ticketId: null,
      verifyCriterion: match.verifyCriterion,
      recommendation: match.recommendation,
      severity: match.severity,
      leverage: match.leverage,
      lastVerifiedAt: null,
      evidence: {},
      createdAt: timestamp,
      firstSeenAt: timestamp,
      attempt: 0,
    });
  }
  return created;
}

export interface AcceptItemOptions extends ClockOptions {
  readonly lane: string;
  readonly writeScope?: readonly string[];
  readonly dependsOn?: readonly string[];
}

export interface AcceptItemResult {
  readonly item: PlanItemRecord;
  readonly ticketDraft: BoardTicketDraft;
}

/**
 * `proposed|regressed` -> `accepted`. Mints a `BoardTicketDraft` carrying the
 * item's `verifyCriterion` as the ticket's ACCEPTANCE (FR-PLAN2: "the plan and
 * the board never diverge on what done means"). Re-accepting a `regressed`
 * item increments `attempt` (design doc §2).
 *
 * NOT as the ticket's `verify`, and W13-31 is why. A `verifyCriterion` is a
 * machine-checkable predicate over a `PlanEvaluationSnapshot` — the same
 * grammar as an item's `condition`, e.g. `receipts.staleCount == 0`. The close
 * gate EXECUTES `ticket.verify` as a shell command (SC-02's `reRunVerify`), so
 * setting it here made every plan-derived ticket fail its gate on every
 * attempt with `command not found` (exit 127, confirmed by running it) and
 * park for a reason that had nothing to do with the work.
 *
 * Two subsystems agreed on a field NAME and disagreed on its MEANING. FR-PLAN2
 * is satisfied by the acceptance line below — the board states the same
 * done-condition — and the predicate keeps its proper evaluator in
 * `evaluateAcceptedItem`, which re-checks it against a fresh snapshot. Leaving
 * `verify` unset falls the ticket back to the project's own gate, which is a
 * command.
 */
export function acceptItem(
  item: PlanItemRecord,
  opts: AcceptItemOptions,
): AcceptItemResult {
  if (item.state !== 'proposed' && item.state !== 'regressed') {
    throw new PlanLifecycleError(
      'INVALID_TRANSITION',
      `cannot accept item "${item.id}" from state "${item.state}" (only proposed/regressed accept)`,
    );
  }
  const ticketDraft: BoardTicketDraft = {
    id: `PLAN-${item.catalogId}`,
    type: 'task',
    title: item.recommendation,
    lane: opts.lane,
    writeScope: opts.writeScope ?? [],
    dependsOn: opts.dependsOn ?? [],
    acceptance: [{ id: 'AC-1', text: item.verifyCriterion, done: false }],
    verify: null,
  };
  const nextItem: PlanItemRecord = {
    ...item,
    state: 'accepted',
    ticketId: ticketDraft.id,
    attempt: item.state === 'regressed' ? item.attempt + 1 : item.attempt,
  };
  return { item: nextItem, ticketDraft };
}

/** `accepted` -> `in_progress` (linked ticket claimed). Requires a minted ticket link. */
export function startItem(item: PlanItemRecord): PlanItemRecord {
  if (item.state !== 'accepted') {
    throw new PlanLifecycleError(
      'INVALID_TRANSITION',
      `cannot start item "${item.id}" from state "${item.state}" (only accepted starts)`,
    );
  }
  if (!item.ticketId) {
    throw new PlanLifecycleError(
      'MISSING_TICKET_LINK',
      `cannot start item "${item.id}": accepted without a linked ticket`,
    );
  }
  return { ...item, state: 'in_progress' };
}

export interface VerifyItemOptions extends ClockOptions {
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/**
 * Re-evaluates `item.verifyCriterion` against a fresh `snapshot`:
 *   - `accepted|in_progress` + satisfied -> `done`
 *   - `done` + satisfied -> stays `done` (re-verified, timestamp refreshed)
 *   - `done` + violated -> `regressed` (FR-PLAN3)
 *   - `accepted|in_progress` + violated -> unchanged state (still open work)
 * `proposed`/`regressed` items have no verify semantics yet (they aren't
 * being worked — verify only applies once accepted).
 */
export function verifyItem(
  item: PlanItemRecord,
  snapshot: PlanEvaluationSnapshot,
  opts: VerifyItemOptions = {},
): PlanItemRecord {
  if (
    item.state !== 'accepted' &&
    item.state !== 'in_progress' &&
    item.state !== 'done'
  ) {
    throw new PlanLifecycleError(
      'INVALID_TRANSITION',
      `cannot verify item "${item.id}" from state "${item.state}" (only accepted/in_progress/done verify)`,
    );
  }
  const now = opts.now ?? (() => new Date().toISOString());
  const satisfied = evaluatePredicate(item.verifyCriterion, snapshot);
  const nextState = satisfied ? 'done' : item.state === 'done' ? 'regressed' : item.state;
  return {
    ...item,
    state: nextState,
    lastVerifiedAt: now(),
    evidence: opts.evidence ?? item.evidence,
  };
}
