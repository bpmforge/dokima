/**
 * Bridges a pipeline run's `DecomposedPlan` (`@shipwright/pipeline`'s
 * `decompose()` output) onto the board through the EXISTING Improvement
 * Plans lifecycle (`proposeFromMatches`/`acceptItem`) rather than a
 * bespoke ticket-creation path (ticket acceptance criterion #1). This is
 * the same `plan_items` engine `plans-store.ts`/`plans-routes.ts` already
 * use for catalog-matched findings — here the "matches" come from a
 * decompose run instead of `content/plan-catalog/**`, but `proposeFromMatches`
 * doesn't care about the source, only the `CatalogMatch` shape.
 *
 * Two known field-collapses fall out of reusing `acceptItem` as directed
 * (`packages/pipeline/src/plans/lifecycle.ts`) rather than calling
 * `createTicket` directly:
 *   - every decomposed ticket becomes a board ticket of type `'task'`
 *     regardless of its own `epic|story|task|bug` — `acceptItem`'s
 *     `BoardTicketDraft.type` is hardcoded `'task'` (FR-PLAN2's ticket
 *     shape, not this ticket's to change).
 *   - the minted ticket id is `PLAN-${decompose ticket id}`, not the
 *     decompose id verbatim — so `dependsOn` references are rewritten with
 *     the same `PLAN-` prefix to keep the DAG internally consistent (every
 *     id a decomposed ticket's `dependsOn` can reference is itself another
 *     ticket in the same `plan.tickets` list, going through this same
 *     rewrite).
 * Both are documented, not silently dropped (C-1).
 *
 * A third, more consequential mismatch (verified, not fixed here — out of
 * this ticket's write_scope): `acceptItem` (lifecycle.ts) sets
 * `ticketDraft.verify = item.verifyCriterion` — the SAME field becomes both
 * the plan_item's `verifyCriterion` (meant to be an `expr.ts` boolean
 * predicate) and the board ticket's `verify` (an executable shell command).
 * `proposePlanItemsFromDecomposedPlan` sets `CatalogMatch.verifyCriterion =
 * ticket.verify` (the real shell command) — the only correct choice for the
 * board ticket's own close-gate — but that leaves the plan_item's
 * `verifyCriterion` holding a shell command, not a predicate. Decoupling
 * needs a distinct `verifyKind` on `PlanItemRecord`/`CatalogMatch`
 * (`packages/pipeline/src/plans/types.ts`), out of this ticket's reach —
 * flagged, not silently swallowed.
 *
 * Single-writer discipline (DATABASE.md §1): `proposePlanItemsFromDecomposedPlan`
 * opens its own writer for the propose step and closes it before returning;
 * `acceptDecomposedPlanItems` then calls `plans-store.ts`'s `acceptPlanItem`
 * once per created item, sequentially (`for...of` + `await`, never
 * `Promise.all`) — each call opens and closes its own writer in turn, so at
 * most one connection to the project's `state.db` is ever open at a time.
 */
import { appendEvent } from '@shipwright/events';
import {
  proposeFromMatches,
  type CatalogMatch,
  type DecomposedPlan,
} from '@shipwright/pipeline';
import { acceptPlanItem } from '../plans-store.js';
import type { PlanItemRow } from '../plans-types.js';
import {
  fromSqlRow,
  insertRow,
  SELECT_ALL,
  toRecord,
  toRow,
  withPlanWriter,
  type PlanItemSqlRow,
} from '../plans-store-rows.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../server/board-actor.js';

/** `PLAN-${decompose ticket id}` — mirrors `acceptItem`'s own `BoardTicketDraft.id` construction. */
function planTicketId(decomposeTicketId: string): string {
  return `PLAN-${decomposeTicketId}`;
}

export interface PlanItemsFromDecomposedPlanOptions {
  readonly runId: string;
  readonly now?: () => string;
}

/**
 * Proposes one `plan_items` row per decomposed ticket (skips any catalogId
 * already tracked — `proposeFromMatches`' own idempotency, same as
 * `plans-store.ts`'s `evaluatePlan`). Fixed `severity`/`leverage` of 3: a
 * pipeline-decomposed ticket has no catalog-assigned rank, and 3 (the
 * midpoint of the 1-5 scale) keeps it out of both funnel extremes rather
 * than asserting an unearned "critical" or "trivial".
 */
export async function proposePlanItemsFromDecomposedPlan(
  projectPath: string,
  plan: DecomposedPlan,
  opts: PlanItemsFromDecomposedPlanOptions,
): Promise<{ created: readonly PlanItemRow[] }> {
  const now = opts.now ?? (() => new Date().toISOString());
  const matches: CatalogMatch[] = plan.tickets.map((ticket) => ({
    catalogId: ticket.id,
    recommendation: ticket.title,
    verifyCriterion: ticket.verify,
    severity: 3,
    leverage: 3,
  }));
  return withPlanWriter(projectPath, (log) => {
    ensureOperatorIdentity(log, now);
    const existingSqlRows = log.db.prepare(SELECT_ALL).all() as PlanItemSqlRow[];
    const existingRecords = existingSqlRows.map((r) => toRecord(fromSqlRow(r)));
    const created = proposeFromMatches(matches, existingRecords, { now });
    for (const record of created) insertRow(log.db, record);
    if (created.length > 0) {
      appendEvent(
        log,
        {
          eventType: 'pipeline.plan_items_proposed',
          actorId: OPERATOR_ACTOR_ID,
          runId: opts.runId,
          payload: { createdIds: created.map((c) => c.id) },
        },
        { now },
      );
    }
    return { created: created.map(toRow) };
  });
}

export interface AcceptedDecomposedPlanItem {
  readonly item: PlanItemRow;
  readonly ticketCreated: boolean;
}

/**
 * Accepts every just-created item (each starts `proposed`, so every one is
 * accept-eligible) via `plans-store.ts`'s real `acceptPlanItem` — the exact
 * function `POST /plan-items/:id/accept` calls, not a re-implementation.
 * Runs sequentially; see module header for why.
 */
export async function acceptDecomposedPlanItems(
  projectPath: string,
  created: readonly PlanItemRow[],
  plan: DecomposedPlan,
  opts: { now?: () => string } = {},
): Promise<readonly AcceptedDecomposedPlanItem[]> {
  const byId = new Map(plan.tickets.map((t) => [t.id, t]));
  const results: AcceptedDecomposedPlanItem[] = [];
  for (const created_ of created) {
    const ticket = byId.get(created_.catalogId);
    if (!ticket) {
      throw new Error(
        `no decomposed ticket found for catalogId "${created_.catalogId}" — proposePlanItemsFromDecomposedPlan produced an item this plan doesn't own`,
      );
    }
    const dependsOn = ticket.dependsOn.map(planTicketId);
    const { item, ticketCreated } = await acceptPlanItem(
      projectPath,
      created_.id,
      { lane: ticket.lane, writeScope: ticket.writeScope, dependsOn },
      opts,
    );
    results.push({ item, ticketCreated });
  }
  return results;
}

/** Convenience wrapper: propose then accept every decomposed ticket in one call. */
export async function persistDecomposedPlan(
  projectPath: string,
  plan: DecomposedPlan,
  opts: PlanItemsFromDecomposedPlanOptions,
): Promise<readonly AcceptedDecomposedPlanItem[]> {
  const { created } = await proposePlanItemsFromDecomposedPlan(projectPath, plan, opts);
  return acceptDecomposedPlanItems(projectPath, created, plan, opts);
}
