/**
 * The build-run job and its in-process state — chapter of `runs-routes.ts`,
 * split when W19-01's phase-gate wiring pushed the routes file past the
 * 400-line CODE_BOOK_PROTOCOL cap. Extraction plus the W19-01 addition; the
 * routes file keeps registration and imports this state.
 */
import { listEvents, openEventLog } from '@dokima/events';
import { resolveAsset } from '@dokima/shared';
import { resolveSigningKey } from '../../cli/signing-key.js';
import { executeBuildRun } from '../../cli/run-build.js';
import { listTickets } from '@dokima/tickets';
import { stateDbPath } from './board-project.js';
import { attemptPhaseProgress } from './run-phase-progress.js';
import {
  buildRunStopped,
  classifyRunOutcome,
  finishBuildRun,
  startBuildRun,
  sweepInterruptedRuns,
  type BuildRunState,
} from './approved-build-run-state.js';

/**
 * A build run, executed OFF the request (W12-20).
 *
 * WHY THIS EXISTS: every configuration surface in this product is a GUI and
 * the one action that matters was a terminal command. `runs-routes.ts` served
 * only `GET .../runs` and `GET /runs/:id/trace` — both read-only — so a user
 * could register providers, choose a model policy, watch the board and replay
 * a trace, and had no way to START the work from the product.
 *
 * OFF THE REQUEST, not held on it: a build run claims tickets, spawns agent
 * sessions and re-runs gates, which is minutes to hours. W10-58 already moved
 * the creation pipeline off a held HTTP request for the same reason and this
 * reuses that shape — 202 with a run id, progress read from the durable
 * channels (the event log the trace route already serves), never from a live
 * response.
 *
 * REUSES `executeBuildRun` RATHER THAN REIMPLEMENTING THE LOOP. That function
 * already owns the refusal set a user needs to see — unset signing key,
 * unreadable vault, unconstructible provider kind, a pinned policy the land
 * loop cannot honour (W12-18) — and this wave has now consolidated three
 * separate copies of an adapter dispatch that existed because someone
 * reimplemented rather than imported. Its `RunCliIO` is shimmed onto arrays so
 * those refusals become part of the run record instead of vanishing into a
 * stderr nobody is watching.
 */
interface BuildRunOutcome {
  readonly runId: string;
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

const buildRuns = new Map<string, BuildRunOutcome | 'running'>();

/**
 * W17-06: per-run stop flags. The web stop route flips one; the land loop
 * observes it at its next ticket boundary (the existing StopSwitch
 * contract) — no process kill, the in-flight attempt finishes or parks
 * honestly. Route-born build runs mint no RunRecord, so the real `stopRun`
 * verb is attempted-and-tolerated; the durable audit is the ledgered
 * `run.stop_requested` event.
 */
const stopRequests = new Map<string, { stopped: boolean; by: string }>();

/**
 * W23-13: which runs THIS process is actually executing. A `running` record
 * with no entry here is an orphan of a dead process, and only a live process
 * can tell the two apart — a later reader sees the same row either way.
 */
const liveRuns = new Set<string>();

/**
 * Exposed for the stop route and tests.
 *
 * W23-13: the durable state decides, and the map is only a cache in front of
 * it. Before this, a stop for a run this process did not start was `unknown` —
 * so restarting the core made every stopped run stoppable again, and the
 * caller was told the run did not exist.
 */
export function requestBuildRunStop(
  runId: string,
  by: string,
  durable?: { readonly state: BuildRunState | undefined },
): 'ok' | 'already' | 'unknown' {
  const known = buildRuns.has(runId) || durable?.state !== undefined;
  if (!known) return 'unknown';
  if (stopRequests.get(runId)?.stopped || durable?.state?.stopRequested) return 'already';
  stopRequests.set(runId, { stopped: true, by });
  return 'ok';
}

/** Exposed so the status route and its tests read the same map rather than a second one. */
export function buildRunStatus(runId: string): BuildRunOutcome | 'running' | undefined {
  return buildRuns.get(runId);
}
export async function executeBuildRunJob(args: {
  readonly projectPath: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly runId: string;
  readonly now: () => string;
  /** W23-02: the caller opted this run into approved-build-v1 (`approved_build` in the POST body). */
  readonly approvedBuild?: boolean;
  /** W23-02: part of the approved specification's digest. */
  readonly budgetUsd?: number | null;
}): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 1;
  /**
   * W23-13: false only when this call decided it is NOT the writer — a
   * duplicate start for a run already in flight. Writing a terminal record
   * there would report the live run as finished, which is the opposite of
   * what the duplicate check exists to prevent.
   */
  let thisCallOwnsTheRun = true;
  try {
    const log = openEventLog(stateDbPath(args.projectPath));
    try {
      /**
       * W23-13 step 2: the accepted start is DURABLE BEFORE ANYTHING IS
       * DISPATCHED. A start recorded after the work begins cannot answer the
       * question a crash asks, because the crash can happen first.
       */
      const start = startBuildRun(log, {
        runId: args.runId,
        projectId: args.projectId,
        actorId: args.actorId,
        approvedBuild: args.approvedBuild === true,
      });
      if (start.kind === 'refused') {
        stderr.push(start.reason);
        exitCode = 2;
        return;
      }
      if (start.kind === 'duplicate' && liveRuns.has(args.runId)) {
        // One writer. A repeated start for a run already going is not an
        // error and must not become a second worker on the same board.
        stderr.push(`run ${args.runId} is already running — this start did nothing`);
        thisCallOwnsTheRun = false;
        return;
      }
      /**
       * Orphans first: any run this project recorded as started, that no live
       * process is executing, died with its process. Recorded as interrupted
       * before this run begins, so the board never shows two live runs when
       * one of them is a ghost.
       */
      for (const orphan of sweepInterruptedRuns(log, {
        projectId: args.projectId,
        actorId: args.actorId,
        liveRunIds: liveRuns,
      })) {
        stderr.push(`run ${orphan} was interrupted by a process exit and is not live`);
      }
      liveRuns.add(args.runId);
      buildRuns.set(args.runId, 'running');
      exitCode = await executeBuildRun(
        log,
        {
          projectId: args.projectId,
          actorId: args.actorId,
          // W23-13: the in-memory flag OR the ledger. A stop requested before
          // a restart is still a stop.
          stopSwitch: () =>
            stopRequests.get(args.runId)?.stopped === true ||
            buildRunStopped(log, args.runId),
          approvedBuild: args.approvedBuild === true,
          budgetUsd: args.budgetUsd ?? null,
        },
        args.runId,
        {
          cwd: args.projectPath,
          stdout: (line) => stdout.push(line),
          stderr: (line) => stderr.push(line),
          now: args.now,
        },
      );
      // W19-01: the gate runs on the happy path. A clean run attempts the
      // current phase's REAL gate and, on a verified receipt, ledgers the
      // advance — a refusal lands in the review queue, never fails the run.
      if (exitCode === 0) {
        try {
          const signing = await resolveSigningKey({ receiptCount: 1 });
          await attemptPhaseProgress({
            log,
            projectId: args.projectId,
            projectRoot: args.projectPath,
            authorActorId: args.actorId,
            contentDir: resolveAsset('content', 'validators'),
            signingKey: signing.key,
            runId: args.runId,
            now: args.now,
          });
        } catch (err) {
          stderr.push(
            `phase-gate attempt failed (run outcome unchanged): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      /**
       * W23-13 step 3: exit 0 is not completion. A run that landed work and
       * left tickets waiting for a person finished its work and did not
       * finish the build.
       */
      /**
       * W23-16: what still needs a person is NOT just `in_review`. A parked
       * ticket is released back to `ready`, so a run that attempted one ticket
       * and parked it had nothing in review and was reported `verified` —
       * "every ticket this run landed was verified and accepted", which is
       * true only because it landed none. Anything this run CLAIMED and did
       * not finish needs a person too.
       */
      const tickets = listTickets(log);
      const needsAPerson = new Set(
        tickets.filter((t) => t.status === 'in_review').map((t) => t.id),
      );
      for (const event of listEvents(log)) {
        if (event.runId !== args.runId || event.eventType !== 'ticket.claimed') continue;
        const claimed = event.ticketId;
        if (!claimed) continue;
        if (tickets.find((t) => t.id === claimed)?.status !== 'done') {
          needsAPerson.add(claimed);
        }
      }
      const outcome = classifyRunOutcome({
        exitCode,
        stopRequested: buildRunStopped(log, args.runId),
        ticketsAwaitingDecision: needsAPerson.size,
      });
      finishBuildRun(log, {
        runId: args.runId,
        actorId: args.actorId,
        kind: outcome.kind,
        detail: outcome.detail,
        exitCode,
      });
    } finally {
      if (thisCallOwnsTheRun) liveRuns.delete(args.runId);
      log.close();
    }
  } catch (err) {
    // A crash still writes a terminal record: a run stuck at `running` behind a
    // dead job is exactly the opacity W10-58 removed from the creation path.
    stderr.push(err instanceof Error ? err.message : String(err));
  } finally {
    if (thisCallOwnsTheRun) {
      buildRuns.set(args.runId, { runId: args.runId, exitCode, stdout, stderr });
    }
  }
}
