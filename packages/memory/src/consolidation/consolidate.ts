/**
 * Sleep-time consolidation orchestrator (FR-M3, BLUEPRINT §3.8, US-603):
 * "a scheduled job (idle hours) dedupes, decays, consolidates, and
 * pre-briefs the next morning's queue. On by default." This module owns the
 * job's BODY — actual wall-clock scheduling (cron / idle-hours detection) is
 * a scheduler's job (apps/server or packages/harbormaster), out of this
 * ticket's write_scope; `runSleepConsolidation` is what that scheduler calls
 * once it decides it's idle hours. `enabled` defaults to true (ON by
 * default, FR-M3); a caller wires a project's settings-resolved override in
 * (`enabled: false`) to satisfy US-603 AC-1 ("can be toggled off per
 * project") without this package needing to know anything about FR-S1's
 * settings scopes.
 */
import { noopConsolidationSink, type ConsolidationSink } from './events.js';
import { dedupeFacts, type DedupeMerge } from './dedupe.js';
import { decayStaleFacts } from './decay.js';
import { buildMorningPreBrief, type MorningPreBrief } from './pre-brief.js';
import type { SqliteHandle } from '../store/handle.js';

/** FR-M3: sleep-time consolidation is ON by default, absent an explicit per-project override. */
export const CONSOLIDATION_ENABLED_BY_DEFAULT = true;

export interface RunConsolidationOptions {
  /** Project-level override (US-603 AC-1). Defaults to `CONSOLIDATION_ENABLED_BY_DEFAULT`. */
  readonly enabled?: boolean;
  readonly now?: () => string;
  readonly maxIdleDays?: number;
  readonly sink?: ConsolidationSink;
}

export interface ConsolidationReport {
  readonly ranAt: string;
  /** True when the job no-opped because consolidation is disabled for this project. */
  readonly skipped: boolean;
  readonly dedupeMerges: readonly DedupeMerge[];
  readonly decayedFactIds: readonly number[];
  readonly preBrief: MorningPreBrief | null;
}

/**
 * Runs dedupe -> decay -> pre-brief (the "consolidate" step is dedupe+decay
 * together — the pass that keeps the fact bank lean) and emits exactly one
 * `memory.consolidated` event on a real run (DATABASE.md §5: "even memory
 * mutations are audited"). A disabled run emits nothing and touches nothing.
 */
export function runSleepConsolidation(
  handle: SqliteHandle,
  options: RunConsolidationOptions = {},
): ConsolidationReport {
  const now = options.now ?? (() => new Date().toISOString());
  const ranAt = now();
  const enabled = options.enabled ?? CONSOLIDATION_ENABLED_BY_DEFAULT;

  if (!enabled) {
    return { ranAt, skipped: true, dedupeMerges: [], decayedFactIds: [], preBrief: null };
  }

  const dedupeMerges = dedupeFacts(handle);
  const decayedFactIds = decayStaleFacts(handle, {
    now,
    maxIdleDays: options.maxIdleDays,
  });
  const preBrief = buildMorningPreBrief(handle, { ranAt, dedupeMerges, decayedFactIds });

  const sink = options.sink ?? noopConsolidationSink;
  void sink.emit({
    type: 'memory.consolidated',
    occurredAt: ranAt,
    detail: {
      dedupeMergeCount: dedupeMerges.length,
      decayedCount: decayedFactIds.length,
      preBriefLeadFactCount: preBrief.leadFacts.length,
    },
  });

  return { ranAt, skipped: false, dedupeMerges, decayedFactIds, preBrief };
}
