/**
 * Improvement Plans row/wire types (FR-PLAN2/4, D-016, DATABASE.md §5b).
 * Engine types (`PlanEvaluationSnapshot`, `PlanItemRecord`, `CatalogMatch`,
 * ...) come straight from `@shipwright/pipeline` — this file only adds the
 * two fields the engine deliberately keeps out of its scope (`dismissedAt`/
 * `dismissedReason`, see `plans-store.ts`'s header) and the funnel shape
 * AC2 asks for.
 */

import type { PlanItemRecord, PlanItemState } from '@shipwright/pipeline';

export type { PlanItemState };

export interface PlanItemRow extends PlanItemRecord {
  readonly dismissedAt: string | null;
  readonly dismissedReason: string | null;
}

export class PlanStoreError extends Error {
  readonly code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'DUPLICATE_TICKET';

  constructor(code: PlanStoreError['code'], message: string) {
    super(message);
    this.name = 'PlanStoreError';
    this.code = code;
  }
}

/**
 * FR-RL4-style funnel (AC2: "raw findings -> plan items -> accepted ->
 * done/regressed"). `rawFindings` includes dismissed rows (never hidden);
 * every later stage excludes them (a dismissed item did not become active
 * plan work). `raw findings` == every catalog match this project has ever
 * proposed — this ticket has no live findings-ledger source to widen that
 * definition against (no `findings` table exists in apps/server yet); the
 * wiring ticket (W5-15) assembling real snapshots is the natural place to
 * revisit it.
 */
export interface PlanFunnel {
  readonly rawFindings: number;
  readonly planItems: number;
  readonly accepted: number;
  readonly done: number;
  readonly regressed: number;
}
