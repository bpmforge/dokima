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
import {
  CostLedger,
  FitnessCardStore,
  GatewayPool,
  ROLE_CODING_AGENT,
  type Provider,
} from '@dokima/gateway';
import type { SpawnSession } from '@dokima/loop';
import {
  createGatewaySpawnSession,
  createWatchdogChildProcessSpawn,
  DEFAULT_AGENT_SESSION_TASK_TYPE,
  DEFAULT_MAX_TOOL_ITERATIONS,
  type ExternalToolset,
  type LandRungSessions,
  type PolicyRung,
  type WatchdogBreach,
} from '@dokima/harbormaster';
import { createMemoryAnchor, getCalibration } from '@dokima/memory';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';
import {
  resolveModelTargetChain,
  type PinnedModel,
  type ResolvedModelTarget,
} from '../api/pipeline/model-resolution.js';
import type { BuildRunCommand, RunCliIO } from './run-types.js';
import { MAX_TOOL_ITERATIONS_CEILING } from './run-build-policy.js';

/**
 * W17-01 (FR-L3, downward only): a maker whose calibration record shows a
 * real over-claiming history starts with a SMALLER budget — it earns the
 * rest back through observable progress. Never enlarges, never guesses:
 * no record or too few samples leaves the base untouched.
 */
export function calibratedBaseIterations(
  base: number,
  record: { readonly bias: number; readonly sampleCount: number } | undefined,
): number {
  if (!record || record.bias <= 0) return base;
  const shrunk = Math.floor(base * (1 - Math.min(record.bias, 0.5)));
  return Math.max(4, Math.min(shrunk, base));
}

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
/** W16-02: ONE pool per process (FR-F3's "process-wide" is literal) — every session, every rung, every berth shares it. */
const SHARED_GATEWAY_POOL = new GatewayPool();

export interface BuiltInSpawn {
  readonly spawn: SpawnSession;
  readonly contextWindowTokens: number | undefined;
  /** W15-01: the C-4 comparison anchor for the review pass — the R1 (default) maker model. */
  readonly makerModel: string;
  /**
   * W16-01: the rung->session seam for `runLandLoop`. One bound session per
   * real rung of the user's chain; a one-model chain has every rung resolve
   * to the same session, which IS the honest single-rung ladder (FR-G5).
   */
  readonly rungSessions: LandRungSessions;
  /** Every model label a rung session has actually run — the C-4 refusal set for review (a reviewer must not match ANY model that made work this run). */
  readonly usedModels: () => readonly string[];
  /** An honest note about the ladder's real shape (one rung, or fallbacks that could not bind) — printed once at run start; undefined when the ladder is exactly what the user configured. */
  readonly ladderNote: string | undefined;
}

export async function buildBuiltInSpawn(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
  secretValues: readonly string[],
  pin: PinnedModel | undefined,
  maxIterations: number | undefined,
  maxTurnTokens: number | undefined,
  maxSessionSeconds: number | undefined,
  externalTools?: ExternalToolset,
): Promise<BuiltInSpawn> {
  // W16-01: the WHOLE chain the user configured, not just its head — this is
  // where the BLUEPRINT §3.3 ladder becomes real. Entry 0 binds exactly as
  // `resolveModelTarget` always did (same refusals); a pinned model yields a
  // one-entry chain by construction (D-027: `fallbackChain: []`).
  const chain = await resolveModelTargetChain({
    projectPath: io.cwd,
    role: ROLE_CODING_AGENT,
    taskType: DEFAULT_AGENT_SESSION_TASK_TYPE,
    actorId: command.actorId,
    // D-027: a pinned model reaches the session as a run-scoped matrix entry,
    // through `route()` — so C-4 and the fitness guard stay live and the land
    // loop below never learns a model was involved.
    ...(pin ? { pin } : {}),
  });

  const buildSession = async (
    target: ResolvedModelTarget,
  ): Promise<{ spawn: SpawnSession; window: number | undefined }> => {
    const raw: Provider = await providerForConfig(targetToConfig(target, process.env));
    // W16-02 (FR-F3/§3.11): every chat flows through the process-wide pool —
    // one FairScheduler per endpoint, fair by project, so N concurrent
    // berths cannot starve a local endpoint that serves one request at a
    // time (FR-G1) and a second project's calls interleave fairly.
    const endpointId = `${target.providerId}:${target.baseUrl ?? ''}`;
    const provider: Provider = {
      id: raw.id,
      chat: (request) =>
        SHARED_GATEWAY_POOL.run(endpointId, command.projectId, () => raw.chat(request)),
      listModels: () => raw.listModels(),
      getContextLength: (model) => raw.getContextLength(model),
      health: () => raw.health(),
      warmUp: () => raw.warmUp(),
      queueStats: () => raw.queueStats(),
    };
    // W12-04: the context window comes from the Provider, not from
    // `ResolvedModelTarget` (which carries no window field) — so it is read
    // here, where the provider is already built, rather than resolving the
    // model a second time in the packer's call path. `undefined` (a provider
    // that cannot report one) becomes the packer's documented 32k floor.
    const window = await provider.getContextLength(target.model).catch(() => undefined);
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
      // W14-05: error-first — a prior failure on this ticket LEADS the anchor
      // (US-602), so a retry meets the symptom before anything else.
      memoryAnchor: createMemoryAnchor(log.db, { errorFirst: true }),
      // W14-03: external MCP tools, composed by mcp-session-tools.ts from the
      // run's live client pool + the role's grants. Absent = the closed seven.
      ...(externalTools ? { externalTools } : {}),
      // W13-11: the user's tool-turn cap, when they set one. Absent = the
      // documented default; this field was previously never set at all.
      // W17-01: whichever base applies, it now EARNS extensions from real
      // progress up to the unchanged T-27 ceiling, shrunk first for a
      // maker with an over-claiming record (downward only, FR-L3).
      ...((): { maxIterations?: number } => {
        const base = maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
        const calibrated = calibratedBaseIterations(
          base,
          getCalibration(log.db, target.model, 'coding-agent') ?? undefined,
        );
        return { maxIterations: calibrated };
      })(),
      progressBudget: { ceiling: MAX_TOOL_ITERATIONS_CEILING },
      ...(maxTurnTokens === undefined ? {} : { maxTurnTokens }),
      ...(maxSessionSeconds === undefined ? {} : { maxSessionSeconds }),
      secretValues,
      now: io.now,
    });
    return { spawn, window };
  };

  // Eager, deduped by model+provider: a chain rarely exceeds three entries,
  // and a ladder that fails to bind should refuse at run START, not mid-climb.
  const sessions: {
    target: ResolvedModelTarget;
    spawn: SpawnSession;
    window: number | undefined;
  }[] = [];
  for (const target of chain.targets) {
    const existing = sessions.find(
      (s) => s.target.model === target.model && s.target.providerId === target.providerId,
    );
    if (existing) {
      sessions.push(existing);
      continue;
    }
    const built = await buildSession(target);
    sessions.push({ target, ...built });
  }
  const head = sessions[0]!;

  // The packer packs ONCE per handoff for whichever rung runs it, so the only
  // safe window is the smallest one any rung reports (unknown stays unknown —
  // the packer's documented conservative floor).
  const knownWindows = sessions
    .map((s) => s.window)
    .filter((w): w is number => w !== undefined);
  const contextWindowTokens =
    knownWindows.length === sessions.length && knownWindows.length > 0
      ? Math.min(...knownWindows)
      : undefined;

  const used = new Set<string>([]);
  const forRung = (rung: PolicyRung): { spawn: SpawnSession; label: string } => {
    const index = rung === 'R1' ? 0 : rung === 'R2' ? 1 : 2;
    // Clamped to the last real entry: a one-model chain answers every rung
    // with that model — the honest single-rung ladder, never a silent
    // substitution upward (law 9b: the user's chain is the whole universe).
    const chosen = sessions[Math.min(index, sessions.length - 1)]!;
    return {
      label: chosen.target.model,
      spawn: async (input) => {
        used.add(chosen.target.model);
        return chosen.spawn(input);
      },
    };
  };

  const notes: string[] = [];
  if (sessions.length === 1) {
    notes.push(
      `the escalation ladder has one real rung (${head.target.model}) — every ` +
        `retry re-runs it. Add fallback models in Settings → Models to give ` +
        `the ladder somewhere to climb.`,
    );
  }
  for (const miss of chain.unbindable) {
    notes.push(
      `fallback "${miss.modelRef}" is configured but could not bind, so the ` +
        `ladder skips it: ${miss.reason}`,
    );
  }

  return {
    spawn: forRung('R1').spawn,
    contextWindowTokens,
    makerModel: head.target.model,
    rungSessions: { sessionForRung: forRung },
    usedModels: () => [...used],
    ladderNote: notes.length ? notes.join('\n') : undefined,
  };
}
/**
 * The external-CLI agent, under the watchdog it was always missing (W13-47).
 *
 * `createChildProcessSpawn` waits on the child for as long as that child runs.
 * W13-42, W13-43 and W13-44 all bounded the BUILT-IN agent; this path had
 * nothing — and it is the one where a real kill is possible, which is exactly
 * why W13-44 had to settle for a cooperative check instead.
 *
 * THE WRAPPER IS THE POINT, not the swap. `createWatchdogChildProcessSpawn`
 * kills the process tree and then resolves from the child's `close` event with
 * whatever that process happened to emit before it died — so on breach the
 * caller gets a truncated session and NO reason. `onBreach` is the only place
 * the reason exists. Capturing it here and appending it to `stderr` is what
 * puts it in front of a person, because W13-41 carries session stderr into the
 * park comment.
 *
 * The exit code is forced non-zero on breach: a killed tree can exit 0, and a
 * session that was killed must never read as one that finished.
 */
export function createWatchedExternalSpawn(options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly maxSessionSeconds: number;
}): SpawnSession {
  // Collected rather than assigned. Control-flow analysis cannot see the write
  // inside `onBreach`, so a variable narrows to `never` at the read below and
  // the compiler "proves" a breach can never happen; an array read is honest
  // about being possibly-absent.
  const breaches: WatchdogBreach[] = [];
  const inner = createWatchdogChildProcessSpawn({
    command: options.command,
    args: options.args,
    maxSessionSeconds: options.maxSessionSeconds,
    // A turn boundary is invisible from out here, so the only honest heartbeat
    // is output: `createWatchdogChildProcessSpawn` bumps it on stdout/stderr
    // data. Set equal to the wall clock so a quiet-but-working process is
    // judged on the ceiling alone rather than on silence it never promised to
    // break.
    heartbeatStallSeconds: options.maxSessionSeconds,
    onBreach: (detected) => {
      breaches.push(detected);
    },
  });

  return async (input) => {
    breaches.length = 0;
    const out = await inner(input);
    const detected = breaches[0];
    if (!detected) return out;
    return {
      stdout: out.stdout,
      stderr:
        `${out.stderr}\nagent session stopped: the watchdog killed the external ` +
        `agent after ${Math.round(detected.elapsedMs / 1000)}s (ceiling ` +
        `${options.maxSessionSeconds}s, reason ${detected.reason}). Its process ` +
        `tree was terminated, so any output above is partial.`,
      exitCode: out.exitCode === 0 || out.exitCode === null ? 1 : out.exitCode,
    };
  };
}

/**
 * W16-01: the rung seam as `run-build.ts` wires it — the honest ladder-shape
 * note printed once at run start (FR-G5: degrade honestly, never silently)
 * and a stderr notice on every climb, composed here so the orchestrator
 * stays under the CODE_BOOK_PROTOCOL file cap.
 */
export function announceRungSessions(
  builtIn: BuiltInSpawn,
  runId: string,
  stderr: (line: string) => void,
): LandRungSessions {
  if (builtIn.ladderNote) stderr(`${runId}: ${builtIn.ladderNote}`);
  return {
    sessionForRung: builtIn.rungSessions.sessionForRung.bind(builtIn.rungSessions),
    onRungAdvance: (advance) => {
      stderr(
        `${runId}: ${advance.ticketId} escalates ${advance.fromRung} -> ` +
          `${advance.toRung} (${advance.sessionLabel}) — the previous attempt's ` +
          `gate evidence is on the escalation event.`,
      );
    },
  };
}
