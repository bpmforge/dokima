/**
 * Morning-queue pre-brief (US-603 AC-2: "Morning queue includes the
 * pre-brief when the job ran overnight"). This module builds the DATA the
 * morning queue renders — `packages/memory` can't reach the notification
 * center itself (apps/server, outside this ticket's write_scope); a caller
 * wires this summary into a notification the same way `playbook/promote.ts`
 * hands a prepared payload to `packages/events`' real promotion function,
 * never talking to that system directly.
 */
import type { SqliteHandle } from '../store/handle.js';
import type { DedupeMerge } from './dedupe.js';

export interface MorningPreBriefFact {
  readonly id: number;
  readonly kind: string;
  readonly content: string;
}

export interface MorningPreBrief {
  readonly ranAt: string;
  readonly dedupedCount: number;
  readonly decayedCount: number;
  /** Most-recent verified error->solution facts — the crew's overnight landmines, surfaced first. */
  readonly leadFacts: readonly MorningPreBriefFact[];
}

export interface BuildPreBriefInput {
  readonly ranAt: string;
  readonly dedupeMerges: readonly DedupeMerge[];
  readonly decayedFactIds: readonly number[];
}

interface LeadFactRow {
  id: number;
  kind: string;
  content: string;
}

const LEAD_FACT_LIMIT = 5;

export function buildMorningPreBrief(
  handle: SqliteHandle,
  input: BuildPreBriefInput,
): MorningPreBrief {
  const rows = handle
    .prepare<LeadFactRow>(
      `SELECT id, kind, content FROM facts
       WHERE verified = 1 AND decayed = 0 AND kind = 'error_solution'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(LEAD_FACT_LIMIT);

  return {
    ranAt: input.ranAt,
    dedupedCount: input.dedupeMerges.reduce(
      (sum, merge) => sum + merge.mergedIds.length,
      0,
    ),
    decayedCount: input.decayedFactIds.length,
    leadFacts: rows,
  };
}
