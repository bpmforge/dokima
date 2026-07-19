/**
 * The two live callers FR-PLAN1/FR-PLAN3 need (docs/design/
 * IMPROVEMENT_PLANS.md §2, split from W5-10 into this ticket):
 *   - `pollRunCompletions`: after every completed run and on Improve-mode
 *     entry, invoke the real catalog engine (`evaluatePlan`) against a
 *     fresh live snapshot — AC1.
 *   - `runNightlyVerify`: on a schedule, re-evaluate every accepted item's
 *     verify criterion (`verifyPlan`), flip done/regressed, and emit
 *     Review-tier notifications on regression — AC2. `verifyPlan`
 *     (`../api/plans-store.ts`) already does the flip + notification
 *     itself; this only supplies the fresh snapshot and the schedule.
 *     Neither function calls `acceptPlanItem` or mints a ticket — zero
 *     Decide-tier auto-actions, per AC2's explicit requirement.
 *
 * Both loops process one registered project at a time and must not let one
 * project's failure (a transient DB error, a locked state.db, a malformed
 * catalog file) sink every other project in the same tick — each
 * project's body is wrapped in its own try/catch, reported via `onError`.
 * `pollRunCompletions` only advances a project's event-log cursor past a
 * trigger once it has been processed without error (at-least-once —
 * `evaluatePlan`/`proposeFromMatches` is idempotent per catalogId, so a
 * retried trigger can never double-propose).
 *
 * `startPlanScheduler` wires both onto real timers for the running
 * `apps/server` process; the two functions above are exported directly so
 * tests drive them without waiting on wall-clock time.
 */

import { computeFleetRegistryPath, listProjectCards } from '../api/projects.js';
import { evaluatePlan, listPlanItems, verifyPlan } from '../api/plans-store.js';
import {
  isImproveModeEntry,
  isRunCompletion,
  listRunTriggerEvents,
} from './run-events.js';
import { buildPlanEvaluationSnapshot, unresolvedSnapshotPaths } from './snapshot.js';

/** A verifiable-state item this pass could not honestly re-verify (see `snapshot.ts`). */
export interface SkippedVerifyItem {
  readonly catalogId: string;
  readonly unresolvedPaths: readonly string[];
}

const VERIFY_TRACKED_STATES = new Set(['accepted', 'in_progress', 'done']);

function defaultOnError(projectPath: string, err: unknown): void {
  console.error(`[plan-scheduler] project "${projectPath}" pass failed:`, err);
}

function defaultOnVerifySkipped(
  projectPath: string,
  skipped: readonly SkippedVerifyItem[],
): void {
  console.warn(
    `[plan-scheduler] skipped nightly verify for "${projectPath}" — ` +
      `${skipped.length} item(s) depend on a field with no live producer yet: ` +
      skipped.map((s) => `${s.catalogId}(${s.unresolvedPaths.join(',')})`).join(', '),
  );
}

export interface PlanScheduleOptions {
  readonly now?: () => string;
  /** Reports a single project's pass failing — the other projects in this tick still run. */
  readonly onError?: (projectPath: string, err: unknown) => void;
  /** Reports a project's nightly verify pass being skipped this round — AC2's "logging/metric-counting the skip". */
  readonly onVerifySkipped?: (
    projectPath: string,
    skipped: readonly SkippedVerifyItem[],
  ) => void;
}

/**
 * One run-completion-hook pass: for every registered project, advances
 * that project's event-log cursor and, if a `run.completed` or an
 * Improve-mode `run.created` landed since the last pass, invokes
 * `evaluatePlan` against a freshly-assembled live snapshot.
 *
 * `cursors` is caller-owned, in-memory, keyed by project path — a process
 * restart naturally resets it to "scan from the start". That's safe, not
 * wasteful-by-correctness: `evaluatePlan`/`proposeFromMatches`
 * (`packages/pipeline/src/plans/lifecycle.ts`) is idempotent per
 * `catalogId` (an already-tracked item is left alone), so re-processing
 * already-seen trigger events after a restart can never double-propose.
 */
export async function pollRunCompletions(
  fleetHome: string | undefined,
  cursors: Map<string, number>,
  opts: PlanScheduleOptions = {},
): Promise<void> {
  const onError = opts.onError ?? defaultOnError;
  const projects = await listProjectCards(computeFleetRegistryPath(fleetHome));
  for (const project of projects) {
    try {
      const sinceSeq = cursors.get(project.path) ?? 0;
      const { events, maxSeq } = await listRunTriggerEvents(project.path, sinceSeq);
      const triggered = events.some((e) => isRunCompletion(e) || isImproveModeEntry(e));
      if (triggered) {
        const snapshot = await buildPlanEvaluationSnapshot(project.path);
        await evaluatePlan(project.path, snapshot, { now: opts.now });
      }
      cursors.set(project.path, maxSeq);
    } catch (err) {
      onError(project.path, err);
    }
  }
}

/**
 * Nightly auto-verify (FR-PLAN3): re-evaluates every registered project's
 * accepted/in_progress/done plan items against a fresh snapshot via the
 * real engine. Must only ever call `verifyPlan` — never `acceptPlanItem`
 * or any other ticket-minting verb.
 */
export async function runNightlyVerify(
  fleetHome: string | undefined,
  opts: PlanScheduleOptions = {},
): Promise<void> {
  const onError = opts.onError ?? defaultOnError;
  const onVerifySkipped = opts.onVerifySkipped ?? defaultOnVerifySkipped;
  const projects = await listProjectCards(computeFleetRegistryPath(fleetHome));
  for (const project of projects) {
    try {
      const { items } = await listPlanItems(project.path);
      const skipped: SkippedVerifyItem[] = [];
      for (const item of items) {
        if (!VERIFY_TRACKED_STATES.has(item.state)) continue;
        const unresolvedPaths = unresolvedSnapshotPaths(item.verifyCriterion);
        if (unresolvedPaths.length > 0) {
          skipped.push({ catalogId: item.catalogId, unresolvedPaths });
        }
      }
      if (skipped.length > 0) {
        onVerifySkipped(project.path, skipped);
        continue;
      }
      const snapshot = await buildPlanEvaluationSnapshot(project.path);
      await verifyPlan(project.path, snapshot, { now: opts.now });
    } catch (err) {
      onError(project.path, err);
    }
  }
}

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_NIGHTLY_MS = 24 * 60 * 60 * 1000;

export interface PlanSchedulerOptions {
  readonly fleetHome?: string;
  readonly runCompletionPollMs?: number;
  readonly nightlyIntervalMs?: number;
  readonly now?: () => string;
  readonly onError?: (phase: 'poll' | 'nightly', err: unknown) => void;
  readonly onVerifySkipped?: (
    projectPath: string,
    skipped: readonly SkippedVerifyItem[],
  ) => void;
}

export interface PlanSchedulerHandle {
  stop(): void;
}

/**
 * Wires `pollRunCompletions`/`runNightlyVerify` onto real timers for the
 * `apps/server` process lifetime. Both timers are `.unref()`d — an idle
 * scheduler must never be the reason the process stays alive; the HTTP
 * listener already does that.
 */
export function startPlanScheduler(opts: PlanSchedulerOptions = {}): PlanSchedulerHandle {
  const cursors = new Map<string, number>();
  const onError =
    opts.onError ??
    ((phase: 'poll' | 'nightly', err: unknown) => {
      console.error(`[plan-scheduler] ${phase} pass failed:`, err);
    });

  const pollTimer = setInterval(() => {
    pollRunCompletions(opts.fleetHome, cursors, {
      now: opts.now,
      onError: (_projectPath, err) => onError('poll', err),
    }).catch((err: unknown) => onError('poll', err));
  }, opts.runCompletionPollMs ?? DEFAULT_POLL_MS);
  pollTimer.unref();

  const nightlyTimer = setInterval(() => {
    runNightlyVerify(opts.fleetHome, {
      now: opts.now,
      onError: (_projectPath, err) => onError('nightly', err),
      onVerifySkipped: opts.onVerifySkipped,
    }).catch((err: unknown) => onError('nightly', err));
  }, opts.nightlyIntervalMs ?? DEFAULT_NIGHTLY_MS);
  nightlyTimer.unref();

  return {
    stop(): void {
      clearInterval(pollTimer);
      clearInterval(nightlyTimer);
    },
  };
}
