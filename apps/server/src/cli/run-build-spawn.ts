/**
 * cli/run-build-spawn.ts — building the built-in agent's session.
 *
 * Second chapter split out of `run-build.ts` under the 400-line
 * CODE_BOOK_PROTOCOL cap, after `run-build-policy.ts` (W12-18). The seam is
 * real rather than convenient: `executeBuildRun` orchestrates a run, and this
 * constructs the session that run will drive. Wiring D-027's pinned model
 * through is what pushed the file to 406.
 */
import type { EventLog } from '@dokima/events';
import { CostLedger, FitnessCardStore, ROLE_CODING_AGENT, type Provider } from '@dokima/gateway';
import type { SpawnSession } from '@dokima/loop';
import { createGatewaySpawnSession, DEFAULT_AGENT_SESSION_TASK_TYPE } from '@dokima/harbormaster';
import { createMemoryAnchor } from '@dokima/memory';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';
import { resolveModelTarget, type PinnedModel } from '../api/pipeline/model-resolution.js';
import type { BuildRunCommand, RunCliIO } from './run-types.js';

/**
 * Builds the built-in agent's `SpawnSession` (D-023): resolves the
 * `coding-agent`/`code` model target the same way the pipeline's own
 * production model-call path does (`resolveModelTarget` — degrades to the
 * local-first env default when nothing is configured, C-1, never throws),
 * binds ONE real `Provider` to it, and gives `createGatewaySpawnSession` a
 * minimal one-entry matrix that always resolves to that same target — the
 * per-model `resolveProvider` callback ignores its argument because exactly
 * one target was ever resolved. Throws `ModelResolutionError` for a
 * registered-but-not-yet-constructible cloud kind (anthropic/openai/vertex/
 * copilot); the caller turns that into a named CLI refusal rather than an
 * uncaught rejection mid-session.
 */
/**
 * The built-in agent's session plus the one fact about its model the packer
 * needs (W12-04). `contextWindowTokens` is `undefined` when the provider
 * cannot report a window — the packer treats that as its documented 32k
 * floor rather than guessing.
 */
export interface BuiltInSpawn {
  readonly spawn: SpawnSession;
  readonly contextWindowTokens: number | undefined;
}

export async function buildBuiltInSpawn(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
  secretValues: readonly string[],
  pin: PinnedModel | undefined,
  maxIterations: number | undefined,
): Promise<BuiltInSpawn> {
  const target = await resolveModelTarget({
    projectPath: io.cwd,
    role: ROLE_CODING_AGENT,
    taskType: DEFAULT_AGENT_SESSION_TASK_TYPE,
    actorId: command.actorId,
    // D-027: a pinned model reaches the session as a run-scoped matrix entry,
    // through `route()` — so C-4 and the fitness guard stay live and the land
    // loop below never learns a model was involved.
    ...(pin ? { pin } : {}),
  });
  const provider: Provider = await providerForConfig(targetToConfig(target, process.env));
  // W12-04: the context window comes from the Provider, not from
  // `ResolvedModelTarget` (which carries no window field) — so it is read
  // here, where the provider is already built, rather than resolving the
  // model a second time in the packer's call path. `undefined` (a provider
  // that cannot report one) becomes the packer's documented 32k floor.
  const contextWindowTokens = await provider
    .getContextLength(target.model)
    .catch(() => undefined);
  const spawn = createGatewaySpawnSession({
    log,
    role: ROLE_CODING_AGENT,
    matrix: {
      project: {
        [ROLE_CODING_AGENT]: { default: { model: target.model, fallbackChain: [] } },
      },
    },
    actorId: command.actorId,
    projectId: command.projectId,
    runId,
    fitnessStore: new FitnessCardStore(),
    resolveProvider: () => provider,
    ledger: new CostLedger(),
    /**
     * W13-23: prior VERIFIED findings, recalled into the session's anchor
     * block. Composed HERE and not in `harbormaster`, which may not import
     * `memory` (ARCHITECTURE §4) — the same constraint W12-04 solved by
     * composing the packed handoff in `apps/server`.
     *
     * `log.db` is the handle, exactly as W12-09 chose for the code index: the
     * run already holds the event log, so recall lives in the project's own
     * SQLite file rather than a second store nobody backs up.
     *
     * No embedding provider is passed, and that is a decision rather than an
     * omission. `assembleContext` degrades to pure BM25 over verified facts
     * when there is none (`retrieval.ts` AC-1), so a local-only user gets real
     * keyword recall instead of a feature that quietly needs a cloud model
     * (FR-G5, law 9b).
     */
    memoryAnchor: createMemoryAnchor(log.db),
    // W13-11: the user's tool-turn cap, when they set one. Absent = the
    // documented default; this field was previously never set at all.
    ...(maxIterations === undefined ? {} : { maxIterations }),
    secretValues,
    now: io.now,
  });
  return { spawn, contextWindowTokens };
}