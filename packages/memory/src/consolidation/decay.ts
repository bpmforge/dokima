/**
 * Sleep-time decay (FR-M3): a verified fact that has gone unused for a long
 * stretch stops competing for token budget — flips `decayed = 1` (excluded
 * from `store/retrieval.ts`'s `searchFactsBm25` WHERE clause and
 * `store/facts.ts`'s `listFacts` default) without deleting the row; the
 * audit trail never loses a fact, it just stops surfacing it. Decay is
 * idle-based, not use-count-based: a fact recalled once ten months ago is
 * exactly as stale as one never recalled, so the reference point is
 * `last_used_at ?? created_at`.
 */
import type { SqliteHandle } from '../store/handle.js';

export interface DecayOptions {
  readonly now: () => string;
  /** Idle threshold, in days, before a verified fact decays. Default 90. */
  readonly maxIdleDays?: number;
}

const DEFAULT_MAX_IDLE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface DecayCandidateRow {
  id: number;
  created_at: string;
  last_used_at: string | null;
}

/** Marks verified, non-decayed facts idle past the threshold as decayed; returns their ids. */
export function decayStaleFacts(handle: SqliteHandle, options: DecayOptions): number[] {
  const maxIdleDays = options.maxIdleDays ?? DEFAULT_MAX_IDLE_DAYS;
  const thresholdMs = Date.parse(options.now()) - maxIdleDays * MS_PER_DAY;

  const rows = handle
    .prepare<DecayCandidateRow>(
      'SELECT id, created_at, last_used_at FROM facts WHERE verified = 1 AND decayed = 0',
    )
    .all();

  const staleIds: number[] = [];
  for (const row of rows) {
    const referenceMs = Date.parse(row.last_used_at ?? row.created_at);
    if (referenceMs <= thresholdMs) {
      staleIds.push(row.id);
    }
  }

  for (const id of staleIds) {
    handle.prepare('UPDATE facts SET decayed = 1 WHERE id = ?').run(id);
  }

  return staleIds;
}
