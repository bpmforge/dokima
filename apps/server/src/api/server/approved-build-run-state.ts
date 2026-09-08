/**
 * Durable build-run state (W23-13, AB-13).
 *
 * WHAT WAS IN MEMORY: two module-level `Map`s. `buildRuns` held every
 * route-born run's status and `stopRequests` held whether someone had asked it
 * to stop. Both die with the process, and the consequences are not symmetric
 * inconveniences — they are two different lies. A run whose process died reads
 * `running` forever to anyone polling, or vanishes into a 404 as if it had
 * never been started; and a run a person STOPPED comes back unstopped, because
 * the only record of the stop was a boolean in a dead heap.
 *
 * THE LEDGER IS THE SOURCE, THE MAP IS THE CACHE (C-6, and AB-13 step 1's
 * "must not be the only source"). Every transition appends an event before it
 * is believed anywhere, and the state a caller reads is FOLDED from those
 * events, so the answer after a restart is the same answer as before it.
 *
 * NOT A REBUILT `runs.status`. The obvious move is to widen that column's
 * CHECK constraint to carry the five outcomes, which in SQLite means dropping
 * and recreating the table holding every historical run. The log already
 * carries what a projection would: `runs` stays the coarse lifecycle row the
 * verbs maintain, and the fine outcome lives where nothing can silently
 * rewrite it.
 *
 * EXIT 0 IS NOT COMPLETION (step 3). A run that lands three tickets and leaves
 * two waiting for a person exits 0 and has not finished the build. That is
 * `awaiting_decision`, and it reads differently from `verified` on purpose.
 */

import { appendEvent, listEvents, type EventLog } from '@dokima/events';

export const RUN_STARTED_EVENT = 'build.run.started';
export const RUN_OUTCOME_EVENT = 'build.run.outcome';

export type BuildRunOutcomeKind =
  /** Every ticket this run landed was independently verified and accepted. */
  | 'verified'
  /** The work finished; at least one ticket still needs a person. */
  | 'awaiting_decision'
  /** A person asked it to stop. */
  | 'stopped'
  /** It refused or crashed. Nobody asked for this. */
  | 'failed'
  /** The process died while it was live, and a later start found the orphan. */
  | 'interrupted';

export interface BuildRunState {
  readonly runId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly startedAt: string;
  readonly approvedBuild: boolean;
  /** Absent while the run is still live. */
  readonly outcome: BuildRunOutcomeKind | null;
  readonly detail: string | null;
  readonly exitCode: number | null;
  /** True from the moment a stop is requested — durable, unlike the old flag. */
  readonly stopRequested: boolean;
}

export type StartBuildRunResult =
  | { readonly kind: 'started'; readonly state: BuildRunState }
  /** The same run id, same project, already accepted. Idempotent: no second writer. */
  | { readonly kind: 'duplicate'; readonly state: BuildRunState }
  /** The id belongs to another project, or to a run that already finished. */
  | { readonly kind: 'refused'; readonly reason: string };

interface StartedPayload {
  readonly projectId?: unknown;
  readonly approvedBuild?: unknown;
}

/**
 * The state of one run, folded from the log. Returns undefined when no start
 * was ever recorded for this id — which is a different answer from "it is not
 * running", and the routes must keep them different.
 */
export function readBuildRunState(
  log: EventLog,
  runId: string,
): BuildRunState | undefined {
  let state: BuildRunState | undefined;
  for (const event of listEvents(log)) {
    if (event.runId !== runId) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.eventType === RUN_STARTED_EVENT) {
      const started = payload as StartedPayload;
      state = {
        runId,
        projectId: typeof started.projectId === 'string' ? started.projectId : '',
        actorId: event.actorId,
        startedAt: event.createdAt,
        approvedBuild: started.approvedBuild === true,
        outcome: null,
        detail: null,
        exitCode: null,
        stopRequested: false,
      };
    } else if (!state) {
      continue;
    } else if (event.eventType === 'run.stop_requested') {
      state = { ...state, stopRequested: true };
    } else if (event.eventType === RUN_OUTCOME_EVENT) {
      state = {
        ...state,
        outcome: (payload.kind as BuildRunOutcomeKind) ?? 'failed',
        detail: typeof payload.detail === 'string' ? payload.detail : null,
        exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : null,
      };
    }
  }
  return state;
}

/**
 * Records an accepted start BEFORE anything is dispatched (step 2). The
 * idempotency check and the cross-project check are the same read, because
 * they are the same question: is this id already someone's?
 */
export function startBuildRun(
  log: EventLog,
  input: {
    readonly runId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly approvedBuild: boolean;
  },
): StartBuildRunResult {
  const existing = readBuildRunState(log, input.runId);
  if (existing) {
    if (existing.projectId !== input.projectId) {
      /**
       * A run id names work inside ONE project. Answering across projects
       * would let a caller read — and with the stop route, control — another
       * project's run by guessing an id, which is the cheapest possible
       * cross-tenant hole.
       */
      return {
        kind: 'refused',
        reason: `run ${input.runId} belongs to another project`,
      };
    }
    if (existing.outcome !== null) {
      return {
        kind: 'refused',
        reason:
          `run ${input.runId} already finished (${existing.outcome}) — reusing a ` +
          `finished run id would overwrite its history with a second run's`,
      };
    }
    // Same id, same project, still live: the caller asked twice. One writer.
    return { kind: 'duplicate', state: existing };
  }
  appendEvent(log, {
    eventType: RUN_STARTED_EVENT,
    actorId: input.actorId,
    runId: input.runId,
    payload: { projectId: input.projectId, approvedBuild: input.approvedBuild },
  });
  return { kind: 'started', state: readBuildRunState(log, input.runId)! };
}

/** Records how a run ended. Appended once; a second call is ignored by the fold's latest-wins. */
export function finishBuildRun(
  log: EventLog,
  input: {
    readonly runId: string;
    readonly actorId: string;
    readonly kind: BuildRunOutcomeKind;
    readonly detail: string;
    readonly exitCode: number | null;
  },
): void {
  appendEvent(log, {
    eventType: RUN_OUTCOME_EVENT,
    actorId: input.actorId,
    runId: input.runId,
    payload: {
      kind: input.kind,
      detail: input.detail,
      exitCode: input.exitCode,
    },
  });
}

/**
 * Which outcome a finished run had. `exitCode === 0` is not on its own an
 * answer (step 3): a clean run that leaves tickets waiting for a person has
 * not completed the build, and saying it did is how a queue of unread
 * decisions comes to look like a finished project.
 */
export function classifyRunOutcome(input: {
  readonly exitCode: number;
  readonly stopRequested: boolean;
  readonly ticketsAwaitingDecision: number;
}): { readonly kind: BuildRunOutcomeKind; readonly detail: string } {
  if (input.stopRequested) {
    return { kind: 'stopped', detail: 'a person asked this run to stop' };
  }
  if (input.exitCode !== 0) {
    return { kind: 'failed', detail: `the run exited ${input.exitCode}` };
  }
  if (input.ticketsAwaitingDecision > 0) {
    return {
      kind: 'awaiting_decision',
      detail:
        `${input.ticketsAwaitingDecision} ticket(s) still need you — the run finished ` +
        `its work and the build is not complete until someone decides`,
    };
  }
  return {
    kind: 'verified',
    detail: 'every ticket this run landed was verified and accepted',
  };
}

/**
 * Marks every run that was live and is not live any more as `interrupted`.
 * Called when a fresh process takes over: a `running` row behind a dead
 * worker is exactly the opacity this card exists to remove, and it must be
 * said by the process that CAN see there is no worker — no later reader can
 * tell "still going" from "died in the night".
 *
 * NOTHING IS REPLAYED HERE (step 4). It records that the run stopped being
 * live; acceptances, pushes and published artifacts are already-done external
 * effects with their own events, and a resume reads those rather than
 * re-deriving intent from a status.
 */
export function sweepInterruptedRuns(
  log: EventLog,
  input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly liveRunIds: ReadonlySet<string>;
  },
): readonly string[] {
  const started = new Set<string>();
  for (const event of listEvents(log)) {
    if (event.eventType !== RUN_STARTED_EVENT || !event.runId) continue;
    const payload = (event.payload ?? {}) as StartedPayload;
    if (payload.projectId !== input.projectId) continue;
    started.add(event.runId);
  }
  const interrupted: string[] = [];
  for (const runId of started) {
    if (input.liveRunIds.has(runId)) continue;
    const state = readBuildRunState(log, runId);
    if (!state || state.outcome !== null) continue;
    finishBuildRun(log, {
      runId,
      actorId: input.actorId,
      kind: 'interrupted',
      detail:
        'the process running this build exited before it recorded an outcome; ' +
        'nothing was replayed and no completed action was repeated',
      exitCode: null,
    });
    interrupted.push(runId);
  }
  return interrupted;
}

/**
 * Whether new work may start for this run. A stop survives a restart because
 * it is read from the log, not from a flag: the old in-memory switch came back
 * false in a fresh process, so a stopped run resumed on the next start.
 */
export function buildRunStopped(log: EventLog, runId: string): boolean {
  const state = readBuildRunState(log, runId);
  return state?.stopRequested === true || state?.outcome === 'stopped';
}
