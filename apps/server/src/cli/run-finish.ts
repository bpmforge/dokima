/**
 * run-finish.ts — the CLI's one completion call (W23-25).
 *
 * A chapter rather than a paragraph of run-cmd.ts: that file sits at the
 * 400-line CODE_BOOK_PROTOCOL cap, and the explanation below is worth more
 * than the four lines of code it explains.
 */

import { completeRun, getRun } from '@dokima/harbormaster';
import type { EventLog } from '@dokima/events';
import type { RunCliIO } from './run-types.js';

/**
 * The run's work is over, so the run is over (W23-25).
 *
 * NOTHING CALLED `completeRun`. This file drove createRun, pauseRun, stopRun,
 * suspendRun and markRunResumed, and a run that finished its work — idle board,
 * onboard analysis done, every ticket landed or parked — was left `running`
 * for good. Visible consequence: `run-events.ts` (FR-PLAN1, "evaluates after
 * runs") waits for the `run.completed` event that only completeRun appends,
 * and it never arrived, on any project, ever. The verb was built, tested and
 * exported under FR-H3 and adopted by nothing — the W12-04 shape.
 *
 * Only a run still `running` or `paused` completes: a `run stop` from another
 * shell mid-run has already ended it, and completing a stopped run would be a
 * refused transition thrown over housekeeping. A nonzero exit is NOT a
 * completion — the run's status stays as the failure left it, which is what it
 * did before, now on purpose rather than by omission.
 */
export function finishRun(
  log: EventLog,
  runId: string,
  actorId: string,
  io: RunCliIO,
): void {
  const current = getRun(log, runId);
  if (!current || (current.status !== 'running' && current.status !== 'paused')) return;
  const run = completeRun(log, runId, actorId, { now: io.now });
  io.stdout(`${run.id} complete -> ${run.status}`);
}
