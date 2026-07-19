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
 * `startPlanScheduler` wires both onto real timers for the running
 * `apps/server` process; the two functions above are exported directly so
 * tests drive them without waiting on wall-clock time.
 */

import { computeFleetRegistryPath, listProjectCards } from '../api/projects.js';
import { evaluatePlan, verifyPlan } from '../api/plans-store.js';
import {
  isImproveModeEntry,
  isRunCompletion,
  listRunTriggerEvents,
} from './run-events.js';
import { buildPlanEvaluationSnapshot } from './snapshot.js';

export interface PlanScheduleOptions {
  readonly now?: () => string;
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
  const projects = await listProjectCards(computeFleetRegistryPath(fleetHome));
  for (const project of projects) {
    const sinceSeq = cursors.get(project.path) ?? 0;
    const { events, maxSeq } = await listRunTriggerEvents(project.path, sinceSeq);
    cursors.set(project.path, maxSeq);
    const triggered = events.some((e) => isRunCompletion(e) || isImproveModeEntry(e));
    if (!triggered) continue;
    const snapshot = await buildPlanEvaluationSnapshot(project.path);
    await evaluatePlan(project.path, snapshot, { now: opts.now });
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
  const projects = await listProjectCards(computeFleetRegistryPath(fleetHome));
  for (const project of projects) {
    const snapshot = await buildPlanEvaluationSnapshot(project.path);
    await verifyPlan(project.path, snapshot, { now: opts.now });
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
    pollRunCompletions(opts.fleetHome, cursors, { now: opts.now }).catch((err: unknown) =>
      onError('poll', err),
    );
  }, opts.runCompletionPollMs ?? DEFAULT_POLL_MS);
  pollTimer.unref();

  const nightlyTimer = setInterval(() => {
    runNightlyVerify(opts.fleetHome, { now: opts.now }).catch((err: unknown) =>
      onError('nightly', err),
    );
  }, opts.nightlyIntervalMs ?? DEFAULT_NIGHTLY_MS);
  nightlyTimer.unref();

  return {
    stop(): void {
      clearInterval(pollTimer);
      clearInterval(nightlyTimer);
    },
  };
}
