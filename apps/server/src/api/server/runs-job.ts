/**
 * The build-run job and its in-process state — chapter of `runs-routes.ts`,
 * split when W19-01's phase-gate wiring pushed the routes file past the
 * 400-line CODE_BOOK_PROTOCOL cap. Extraction plus the W19-01 addition; the
 * routes file keeps registration and imports this state.
 */
import { openEventLog } from '@dokima/events';
import { resolveAsset } from '@dokima/shared';
import { resolveSigningKey } from '../../cli/signing-key.js';
import { executeBuildRun } from '../../cli/run-build.js';
import { stateDbPath } from './board-project.js';
import { attemptPhaseProgress } from './run-phase-progress.js';

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

/** Exposed for the stop route and tests. */
export function requestBuildRunStop(runId: string, by: string): 'ok' | 'already' | 'unknown' {
  if (!buildRuns.has(runId)) return 'unknown';
  const existing = stopRequests.get(runId);
  if (existing?.stopped) return 'already';
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
}): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  buildRuns.set(args.runId, 'running');
  let exitCode = 1;
  try {
    const log = openEventLog(stateDbPath(args.projectPath));
    try {
      exitCode = await executeBuildRun(
        log,
        {
          projectId: args.projectId,
          actorId: args.actorId,
          stopSwitch: () => stopRequests.get(args.runId)?.stopped === true,
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
    } finally {
      log.close();
    }
  } catch (err) {
    // A crash still writes a terminal record: a run stuck at `running` behind a
    // dead job is exactly the opacity W10-58 removed from the creation path.
    stderr.push(err instanceof Error ? err.message : String(err));
  } finally {
    buildRuns.set(args.runId, { runId: args.runId, exitCode, stdout, stderr });
  }
}
