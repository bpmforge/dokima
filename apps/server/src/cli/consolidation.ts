/**
 * Post-run sleep consolidation (W14-06, FR-M3/US-603). The job body —
 * `runSleepConsolidation` — was built, tested, and never called: its own
 * header says it is "what that scheduler calls once it decides it's idle
 * hours". A run finishing IS the idle moment this local-first product
 * actually has (no daemon, no cron — the process is only alive while a
 * run is), so the run's end is the scheduler.
 *
 * ON by default (FR-M3); a project turns it off with the
 * `memoryConsolidationEnabled` settings key (US-603 AC-1). A malformed
 * value falls back to the default WITH a stderr note rather than refusing:
 * this runs after the work landed, and failing a finished run over a
 * cleanup job's setting would destroy value to protect tidiness.
 *
 * Each real pass appends exactly one `memory.consolidated` event
 * (DATABASE.md §5 "even memory mutations are audited") and lands the
 * morning pre-brief as a Review-tier card. Disabled = no event, no card,
 * no writes — the package's own contract, asserted here at wiring level.
 */

import { appendEvent, type EventLog } from '@dokima/events';
import {
  runSleepConsolidation,
  type ConsolidationReport,
} from '@dokima/memory';
import { emitReviewItem } from '../api/notifications/emit.js';

export const MEMORY_CONSOLIDATION_SETTINGS_KEY = 'memoryConsolidationEnabled';

export function parseConsolidationEnabled(
  raw: unknown,
  stderr: (line: string) => void,
): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === 'boolean') return raw;
  stderr(
    `[memory] ${MEMORY_CONSOLIDATION_SETTINGS_KEY} is ${JSON.stringify(raw)} — ` +
      `expected true or false; running with the default (on)`,
  );
  return true;
}

/**
 * W18-04: clamp on a word boundary with an ellipsis. The hard slice ended a
 * digest mid-word ("…Completion Manifest (T-27). I") — a broken sentence in
 * the one card a founder reads over coffee.
 */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface PostRunConsolidationOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  readonly enabled: boolean;
  readonly now?: () => string;
}

export function runPostRunConsolidation(
  options: PostRunConsolidationOptions,
): ConsolidationReport {
  const report = runSleepConsolidation(options.log.db, {
    enabled: options.enabled,
    ...(options.now ? { now: options.now } : {}),
    sink: {
      emit: (event) => {
        appendEvent(options.log, {
          eventType: event.type,
          actorId: options.actorId,
          runId: options.runId,
          payload: event.detail,
        });
      },
    },
  });

  if (!report.skipped && report.preBrief) {
    const brief = report.preBrief;
    /**
     * W15-04 (design-review finding, CONFIRMED): the first cut emitted its
     * own review/digest card with a freeform body, which (a) broke UX_SPEC
     * §7's "Review items coalesce — one notification per batch" and (b)
     * rendered the summary line as "0 items batched" — a wrong sentence
     * about real work. The pre-brief now joins the review digest through
     * the same door as every other review item, with a summary a novice
     * can read.
     */
    const lead = brief.leadFacts[0];
    emitReviewItem(
      options.log,
      {
        kind: 'digest',
        refType: 'run',
        refId: options.runId,
        title: 'Morning pre-brief — what the fact bank learned',
        summary:
          `${brief.dedupedCount} duplicate fact${brief.dedupedCount === 1 ? '' : 's'} merged, ` +
          `${brief.decayedCount} stale fact${brief.decayedCount === 1 ? '' : 's'} retired` +
          (lead ? ` — the lead lesson: ${truncateAtWord(lead.content, 160)}` : ''),
      },
      { id: `pre-brief-${options.runId}`, actorId: options.actorId },
    );
  }
  return report;
}
