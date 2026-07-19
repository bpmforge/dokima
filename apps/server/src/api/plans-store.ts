/**
 * Improvement Plans persistence (FR-PLAN1-4, D-016, DATABASE.md §5b,
 * docs/design/IMPROVEMENT_PLANS.md). The deterministic engine
 * (catalog matching, ranking, lifecycle transitions) is `@shipwright/
 * pipeline`'s `plans/*` module — already self-contained (zero cross-package
 * imports of its own), so it's a real workspace dependency here rather than
 * ~800 lines reimplemented against apps/server's own tables (the pattern
 * `rule-state-store.ts` had to fall back to for `packages/loop`, which
 * *isn't* import-clean the same way). Row <-> record mapping + the
 * short-lived-writer connection live in `plans-store-rows.ts` (400-line
 * book cap, G-A).
 *
 * Seam with W5-15 (the wiring ticket, out of this write_scope): this store
 * exposes `evaluatePlan`/`verifyPlan` as callable primitives over a
 * caller-supplied `PlanEvaluationSnapshot` — it does not assemble that
 * snapshot from live receipts/coverage/finding-ledger state itself (no
 * `findings` table exists in apps/server yet to source it from honestly).
 * W5-15's run-completion hook and nightly scheduler are expected to call
 * `evaluatePlan`/`verifyPlan` (or the routes wrapping them) with a real
 * snapshot; this ticket's own `plan/evaluate` and `plan/verify` routes
 * exist so the engine is reachable and testable without that wiring.
 *
 * Dismissal (`proposed -> [*]`) is a soft delete, not a `PlanItemState` —
 * see `plan_items` migration's header for why.
 */

import { randomUUID } from 'node:crypto';
import { appendEvent } from '@shipwright/events';
import {
  CATALOG_VERSION,
  PlanLifecycleError,
  acceptItem,
  getPath,
  matchCatalog,
  primaryPath,
  proposeFromMatches,
  rankItems,
  verifyItem,
  type BoardTicketDraft,
  type PlanEvaluationSnapshot,
  type PlanItemRecord,
} from '@shipwright/pipeline';
import { createTicket, getTicket, type CreateTicketInput } from '@shipwright/tickets';
import { emitReviewItem } from './notifications/emit.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from './server/board-actor.js';
import { withSettingsReader } from './server/settings-db.js';
import { PlanStoreError, type PlanFunnel, type PlanItemRow } from './plans-types.js';
import {
  fromSqlRow,
  insertRow,
  loadCatalogEntries,
  SELECT_ALL,
  SELECT_ONE,
  toRecord,
  toRow,
  updateRow,
  VERIFIABLE_STATES,
  withPlanWriter,
  type PlanItemSqlRow,
} from './plans-store-rows.js';

/** FR-RL4-style funnel over ALL rows (dismissed included in `rawFindings` only — never hidden). */
export function computeFunnel(rows: readonly PlanItemRow[]): PlanFunnel {
  const active = rows.filter((r) => !r.dismissedAt);
  const acceptedStates = new Set(['accepted', 'in_progress', 'done', 'regressed']);
  return {
    rawFindings: rows.length,
    planItems: active.length,
    accepted: active.filter((r) => acceptedStates.has(r.state)).length,
    done: active.filter((r) => r.state === 'done').length,
    regressed: active.filter((r) => r.state === 'regressed').length,
  };
}

export interface ListPlanItemsOptions {
  readonly includeDismissed?: boolean;
  readonly now?: () => string;
}

/** Ranked (deterministic, `@shipwright/pipeline`'s `rankItems`) + the funnel over every row. */
export async function listPlanItems(
  projectPath: string,
  opts: ListPlanItemsOptions = {},
): Promise<{ items: readonly PlanItemRow[]; funnel: PlanFunnel }> {
  const now = opts.now ?? (() => new Date().toISOString());
  const sqlRows = await withSettingsReader(
    projectPath,
    [] as PlanItemSqlRow[],
    (db) => db.prepare(SELECT_ALL).all() as PlanItemSqlRow[],
  );
  const allRows = sqlRows.map(fromSqlRow);
  const funnel = computeFunnel(allRows);
  const active = opts.includeDismissed ? allRows : allRows.filter((r) => !r.dismissedAt);
  const byId = new Map(active.map((r) => [r.id, r]));
  const ranked = rankItems(active.map(toRecord), now());
  const items = ranked.map((r) => {
    const row = byId.get(r.id);
    if (!row) throw new Error(`ranking produced unknown item id "${r.id}"`);
    return { ...row, rank: r.rank };
  });
  return { items, funnel };
}

export interface EvaluatePlanOptions {
  readonly now?: () => string;
}

/** Matches the catalog against `snapshot`, persists new `proposed` rows (one per unmatched catalog id). */
export async function evaluatePlan(
  projectPath: string,
  snapshot: PlanEvaluationSnapshot,
  opts: EvaluatePlanOptions = {},
): Promise<{ created: readonly PlanItemRow[] }> {
  const now = opts.now ?? (() => new Date().toISOString());
  const entries = loadCatalogEntries();
  const matches = matchCatalog(entries, snapshot);
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
          eventType: 'plan.items_proposed',
          actorId: OPERATOR_ACTOR_ID,
          payload: {
            catalogVersion: CATALOG_VERSION,
            createdIds: created.map((c) => c.id),
          },
        },
        { now },
      );
    }
    return { created: created.map(toRow) };
  });
}

export interface AcceptPlanItemInput {
  readonly lane: string;
  readonly writeScope?: readonly string[];
  readonly dependsOn?: readonly string[];
}

export interface AcceptPlanItemOptions {
  readonly now?: () => string;
}

/** `proposed|regressed` -> `accepted`; mints a board ticket the first time (re-accepting a regressed item reuses its ticket). */
export async function acceptPlanItem(
  projectPath: string,
  id: string,
  input: AcceptPlanItemInput,
  opts: AcceptPlanItemOptions = {},
): Promise<{ item: PlanItemRow; ticketCreated: boolean }> {
  const now = opts.now ?? (() => new Date().toISOString());
  return withPlanWriter(projectPath, (log) => {
    ensureOperatorIdentity(log, now);
    const sqlRow = log.db.prepare(SELECT_ONE).get(id) as PlanItemSqlRow | undefined;
    if (!sqlRow) throw new PlanStoreError('NOT_FOUND', `no plan item "${id}"`);
    const row = fromSqlRow(sqlRow);
    if (row.dismissedAt) {
      throw new PlanStoreError('INVALID_TRANSITION', `plan item "${id}" was dismissed`);
    }
    let result: { item: PlanItemRecord; ticketDraft: BoardTicketDraft };
    try {
      result = acceptItem(toRecord(row), {
        lane: input.lane,
        writeScope: input.writeScope,
        dependsOn: input.dependsOn,
        now,
      });
    } catch (err) {
      if (err instanceof PlanLifecycleError) {
        throw new PlanStoreError('INVALID_TRANSITION', err.message);
      }
      throw err;
    }
    let ticketCreated = false;
    if (!row.ticketId) {
      if (getTicket(log, result.ticketDraft.id)) {
        throw new PlanStoreError(
          'DUPLICATE_TICKET',
          `ticket "${result.ticketDraft.id}" already exists`,
        );
      }
      const createInput: CreateTicketInput = {
        id: result.ticketDraft.id,
        type: result.ticketDraft.type,
        title: result.ticketDraft.title,
        lane: result.ticketDraft.lane,
        writeScope: [...result.ticketDraft.writeScope],
        dependsOn: [...result.ticketDraft.dependsOn],
        acceptance: result.ticketDraft.acceptance.map((a) => ({ ...a })),
        verify: result.ticketDraft.verify,
      };
      createTicket(log, OPERATOR_ACTOR_ID, createInput, { now });
      ticketCreated = true;
    }
    updateRow(log.db, result.item);
    appendEvent(
      log,
      {
        eventType: 'plan.item_accepted',
        actorId: OPERATOR_ACTOR_ID,
        payload: {
          catalogId: row.catalogId,
          ticketId: result.item.ticketId,
          attempt: result.item.attempt,
          ticketCreated,
        },
      },
      { now },
    );
    return { item: toRow(result.item), ticketCreated };
  });
}

/** `proposed -> [*]` (design doc §2 diagram) — soft delete, requires a note (ledgered). */
export async function dismissPlanItem(
  projectPath: string,
  id: string,
  note: string,
  opts: { now?: () => string } = {},
): Promise<PlanItemRow> {
  const now = opts.now ?? (() => new Date().toISOString());
  return withPlanWriter(projectPath, (log) => {
    ensureOperatorIdentity(log, now);
    const sqlRow = log.db.prepare(SELECT_ONE).get(id) as PlanItemSqlRow | undefined;
    if (!sqlRow) throw new PlanStoreError('NOT_FOUND', `no plan item "${id}"`);
    const row = fromSqlRow(sqlRow);
    if (row.dismissedAt) {
      throw new PlanStoreError(
        'INVALID_TRANSITION',
        `plan item "${id}" is already dismissed`,
      );
    }
    if (row.state !== 'proposed') {
      throw new PlanStoreError(
        'INVALID_TRANSITION',
        `cannot dismiss item "${id}" from state "${row.state}" (only proposed dismisses)`,
      );
    }
    const nowIso = now();
    log.db
      .prepare(
        'UPDATE plan_items SET dismissed_at = ?, dismissed_reason = ? WHERE id = ?',
      )
      .run(nowIso, note, id);
    appendEvent(
      log,
      {
        eventType: 'plan.item_dismissed',
        actorId: OPERATOR_ACTOR_ID,
        payload: { catalogId: row.catalogId, note },
      },
      { now: () => nowIso },
    );
    return { ...row, dismissedAt: nowIso, dismissedReason: note };
  });
}

export interface VerifyPlanOptions {
  readonly now?: () => string;
}

/**
 * Re-evaluates every accepted/in_progress/done item's `verifyCriterion`
 * against `snapshot` (FR-PLAN3). A `done -> regressed` flip emits a
 * Review-tier `drift_report` card via `emitReviewItem` — coalesced into the
 * project's open digest like every other Review-tier emission
 * (`emit-route.ts`'s documented "tier: 'review' always batches" rule) —
 * carrying the violated criterion + the snapshot value that violated it
 * (AC2 "criterion + evidence"). This is the primitive W5-15's nightly
 * scheduler is expected to call with a real snapshot; it does not schedule
 * itself.
 */
export async function verifyPlan(
  projectPath: string,
  snapshot: PlanEvaluationSnapshot,
  opts: VerifyPlanOptions = {},
): Promise<{ verified: readonly PlanItemRow[]; regressed: readonly PlanItemRow[] }> {
  const now = opts.now ?? (() => new Date().toISOString());
  return withPlanWriter(projectPath, (log) => {
    ensureOperatorIdentity(log, now);
    const sqlRows = log.db
      .prepare(
        `SELECT * FROM plan_items WHERE dismissed_at IS NULL AND state IN ${VERIFIABLE_STATES}`,
      )
      .all() as PlanItemSqlRow[];
    const verified: PlanItemRow[] = [];
    const regressed: PlanItemRow[] = [];
    for (const sqlRow of sqlRows) {
      const row = fromSqlRow(sqlRow);
      const record = toRecord(row);
      const metricPath = primaryPath(record.verifyCriterion);
      const evidence = metricPath ? { [metricPath]: getPath(snapshot, metricPath) } : {};
      const next = verifyItem(record, snapshot, { now, evidence });
      updateRow(log.db, next);
      appendEvent(
        log,
        {
          eventType: 'plan.item_verified',
          actorId: OPERATOR_ACTOR_ID,
          payload: {
            catalogId: row.catalogId,
            fromState: record.state,
            toState: next.state,
            evidence,
          },
        },
        { now },
      );
      const nextRow = toRow(next);
      verified.push(nextRow);
      if (record.state === 'done' && next.state === 'regressed') {
        regressed.push(nextRow);
        const evidenceSuffix = metricPath
          ? ` — evidence: ${metricPath}=${JSON.stringify(getPath(snapshot, metricPath))}`
          : '';
        emitReviewItem(
          log,
          {
            kind: 'drift_report',
            refType: 'plan_item',
            refId: next.id,
            title: `Plan item ${next.catalogId} regressed`,
            summary: `Violated verify criterion "${next.verifyCriterion}"${evidenceSuffix}`,
          },
          { id: randomUUID(), actorId: OPERATOR_ACTOR_ID, now },
        );
      }
    }
    return { verified, regressed };
  });
}
