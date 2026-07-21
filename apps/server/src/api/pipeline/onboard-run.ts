/**
 * The one shared onboard/analysis entry point — called by both the HTTP
 * route (`pipeline-routes/onboard.ts`, resolves a registered project's path
 * first) and the CLI (`cli/run-cmd.ts`'s `run start --mode onboard`, which
 * already operates directly on a repo root, no project registry involved).
 * Neither caller re-implements the real dispatch/executor/lifecycle wiring
 * — both just supply `projectPath` + an already-open `EventLog`.
 */
import { appendEvent, type EventLog } from '@shipwright/events';
import type { OnboardRunResult, RunOnboardInput } from '@shipwright/pipeline';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from '../server/board-actor.js';
import {
  acceptOnboardPlanItems,
  flattenOnboardFindings,
  proposePlanItemsFromOnboardFindings,
  type AcceptedOnboardFinding,
} from './onboard-board-lifecycle.js';
import {
  createRealOnboardDispatch,
  resolveOnboardGatewayConfigFromEnv,
  type OnboardGatewayConfig,
  type RealOnboardDispatch,
} from './onboard-dispatch-port.js';
import { runOnboardExecution } from './onboard-executor.js';
import type { PlanItemRow } from '../plans-types.js';

export interface RunOnboardAnalysisOptions {
  readonly log: EventLog;
  readonly runId: string;
  /** Repo root being onboarded — both `runSession`'s `cwd` and the project
   * path the plan-items store/board tickets are persisted against. */
  readonly projectPath: string;
  readonly now?: () => string;
  /** Overrides the default env-resolved gateway config — tests point this at a fake HTTP server. */
  readonly gatewayConfig?: OnboardGatewayConfig;
  /** Overrides the dispatch port entirely — tests that want to skip the real gateway/runSession wiring. */
  readonly dispatch?: RealOnboardDispatch;
}

export interface RunOnboardAnalysisResult {
  readonly result: OnboardRunResult;
  readonly proposed: readonly PlanItemRow[];
  readonly accepted: readonly AcceptedOnboardFinding[];
}

/**
 * Starts and advances one onboard/analysis run end to end (ticket AC1/AC2):
 * real dispatch (gateway + `runSession`) -> `runOnboard` (pure topology,
 * W8-08) -> onboard/health/security findings persisted through the existing
 * plans lifecycle. Throws (no partial persistence) if any step's real
 * dispatch fails — `runOnboardExecution`'s own all-or-nothing guarantee
 * (mirrors `runOnboard`'s own AC3) means no `onboard.run_completed` event
 * and no plan items are ever produced from an incomplete run.
 */
export async function runOnboardAnalysis(
  opts: RunOnboardAnalysisOptions,
): Promise<RunOnboardAnalysisResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const dispatch =
    opts.dispatch ??
    createRealOnboardDispatch({
      config: opts.gatewayConfig ?? resolveOnboardGatewayConfigFromEnv(),
      repoRoot: opts.projectPath,
    });

  ensureOperatorIdentity(opts.log, now);

  const input: RunOnboardInput = { seedContext: { repoRoot: opts.projectPath } };
  const { result, stepArtifacts } = await runOnboardExecution(input, {
    log: opts.log,
    runId: opts.runId,
    now,
    dispatch,
  });

  appendEvent(
    opts.log,
    {
      eventType: 'onboard.run_completed',
      actorId: OPERATOR_ACTOR_ID,
      runId: opts.runId,
      payload: {
        stepIds: Object.keys(result.stepArtifacts),
        coverageManifest: result.coverageManifest,
      },
    },
    { now },
  );

  const origins = flattenOnboardFindings(stepArtifacts);
  const { created } = await proposePlanItemsFromOnboardFindings(
    opts.projectPath,
    origins,
    {
      runId: opts.runId,
      now,
    },
  );
  const accepted = await acceptOnboardPlanItems(opts.projectPath, created, origins, {
    now,
  });

  return { result, proposed: created, accepted };
}
