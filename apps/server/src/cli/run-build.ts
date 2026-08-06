/**
 * cli/run-build.ts — the build-mode run (W10-77, W11-04).
 *
 * Chapter of run-cmd.ts, split under the 400-line CODE_BOOK_PROTOCOL cap that
 * `validate-file-size` enforces repo-wide since W10-49.
 *
 * W11-04 (FR-H6, D-023): the agent that works the board is no longer a
 * required CLI flag with no default. `resolveAgentRunner` below picks it —
 * `--agent-command` (explicit, run-scoped, unchanged shape) first, then the
 * project/global `agentRunner` setting (Settings UI, same generic key/value
 * surface `mcpServers`/`escalationPolicy` use), defaulting to `built-in`:
 * Dokima's own gateway-backed agent session (D-023), never a refusal. This
 * is that session's first live production caller — `createGatewaySpawnSession`
 * (W11-02/03/11/12/14/16) existed only behind its own tests until now.
 */

import type { EventLog } from '@dokima/events';
import {
  collectSecretValues,
  createProjectSecretsVault,
  getEffectiveSettings,
  NoKeychainAdapterError,
  resolveAsset,
  resolveCredentialStore,
  resolveEffectiveValue,
  type JsonValue,
  type ProjectSecretsVault,
} from '@dokima/shared';
import { createChildProcessSpawn, type SpawnSession } from '@dokima/loop';
import {
  createGatewaySpawnSession,
  defaultHandoffBuilder,
  runLandLoop,
  DEFAULT_AGENT_SESSION_TASK_TYPE,
  type PushToRemotesFn,
} from '@dokima/harbormaster';
import {
  CostLedger,
  FitnessCardStore,
  ROLE_CODING_AGENT,
  type Provider,
} from '@dokima/gateway';
import {
  AGENT_RUNNER_SETTINGS_KEY,
  EXTERNAL_AGENT_WARNING,
  parseAgentRunnerSetting,
  type AgentRunnerSetting,
} from '../api/server/settings-types.js';
import {
  ModelResolutionError,
  resolveModelTarget,
} from '../api/pipeline/model-resolution.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import type { BuildRunCommand, RunCliIO } from './run-types.js';

/**
 * `--agent-command` (run-scoped, explicit) wins outright over any stored
 * setting — the same "most specific wins" shape `SCOPE_PRECEDENCE` uses one
 * level up. Absent, the effective project/global `agentRunner` setting
 * decides; absent THAT, `parseAgentRunnerSetting(undefined)` is the
 * built-in default. Never refuses.
 */
async function resolveAgentRunner(
  io: RunCliIO,
  agentCommand: string | undefined,
): Promise<AgentRunnerSetting> {
  if (agentCommand) return { kind: 'external', command: agentCommand };
  const scoped = await getEffectiveSettings({ projectDir: io.cwd });
  const resolved = resolveEffectiveValue(AGENT_RUNNER_SETTINGS_KEY, scoped);
  return parseAgentRunnerSetting(resolved?.value as JsonValue | undefined);
}

const EMPTY_VAULT: ProjectSecretsVault = {
  register: async () => {},
  get: async () => undefined,
  delete: async () => {},
  listNames: async () => [],
  listValues: async () => [],
};

/**
 * `resolveCredentialStore` refuses outright on a platform with no keychain
 * adapter (only macOS today) unless `DOKIMA_NO_KEYCHAIN`/`DOKIMA_VAULT_KEY`
 * are set — and on such a platform `vault.register` would refuse the same
 * way, so no vault secret could ever have been stored to redact. Degrading
 * to an empty vault here costs nothing real; refusing the whole build run
 * over it would (FR-S2's `.env` redaction below is independent and still
 * applies).
 */
function resolveVault(projectDir: string): ProjectSecretsVault {
  try {
    return createProjectSecretsVault(resolveCredentialStore(process.env), projectDir);
  } catch (err) {
    if (err instanceof NoKeychainAdapterError) return EMPTY_VAULT;
    throw err;
  }
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
async function buildBuiltInSpawn(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
  secretValues: readonly string[],
): Promise<SpawnSession> {
  const target = await resolveModelTarget({
    projectPath: io.cwd,
    role: ROLE_CODING_AGENT,
    taskType: DEFAULT_AGENT_SESSION_TASK_TYPE,
    actorId: command.actorId,
  });
  const provider: Provider = providerForConfig(targetToConfig(target, process.env));
  return createGatewaySpawnSession({
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
    secretValues,
    now: io.now,
  });
}

/**
 * The build-mode run (W10-77): claim work off the board and actually do it.
 *
 * Until W10-77 this existed, `run start --mode new_product` minted a run
 * record and returned — measured at under a second on a box whose local
 * model takes ~30s for one call, with the board unchanged and no session
 * anywhere. `--berths` was validated, stored, and read by nothing. The
 * engine it needed (`runLandLoop`: claim -> session -> close gate -> land)
 * was implemented in W3-01a/b/c and exported from nothing until W10-78.
 */
export async function executeBuildRun(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
): Promise<number> {
  const signingKey = process.env.DOKIMA_SIGNING_KEY;
  if (!signingKey) {
    // The close gate MINTS a receipt (C-5). Minting with a placeholder would
    // produce receipts that verify against nothing, which is worse than
    // refusing to start.
    io.stderr(
      `${runId} started, but DOKIMA_SIGNING_KEY is unset — the close gate mints ` +
        `signed receipts and will not mint unverifiable ones. Nothing was claimed.`,
    );
    return 2;
  }

  const secretValues = await collectSecretValues(resolveVault(io.cwd), io.cwd);

  const agentRunner = await resolveAgentRunner(io, command.agentCommand);
  let spawn: SpawnSession;
  if (agentRunner.kind === 'external') {
    const [agentBin, ...agentArgs] = (agentRunner.command ?? '')
      .split(' ')
      .filter(Boolean);
    if (!agentBin) {
      io.stderr(`the external agent command is empty; nothing was claimed`);
      return 2;
    }
    io.stderr(EXTERNAL_AGENT_WARNING);
    spawn = createChildProcessSpawn({ command: agentBin, args: agentArgs });
  } else {
    try {
      spawn = await buildBuiltInSpawn(log, command, runId, io, secretValues);
    } catch (err) {
      if (err instanceof ModelResolutionError) {
        io.stderr(`${runId} started, but the built-in agent refused: ${err.message}`);
        return 2;
      }
      throw err;
    }
  }

  const result = await runLandLoop({
    log,
    actorId: command.actorId,
    projectId: command.projectId,
    repoRoot: io.cwd,
    contentDir: resolveAsset('content', 'validators'),
    signingKey,
    spawn,
    buildHandoff: defaultHandoffBuilder(),
    pushToRemotes: localFirstPushToRemotes,
    secretValues,
    now: io.now,
  });

  for (const outcome of result.processed) {
    io.stdout(
      `${outcome.ticketId}: ${outcome.landed ? 'landed' : `parked (${outcome.parkedReason ?? 'unknown'})`}` +
        ` after ${outcome.attempts.length} attempt(s)`,
    );
  }
  io.stdout(
    `${runId} finished: ${result.processed.filter((o) => o.landed).length} landed, ` +
      `${result.processed.filter((o) => !o.landed).length} parked (stop: ${result.stopReason})`,
  );
  return 0;
}

/**
 * Local-first push (FR-I2 partial). `runLandLoop` defaults `pushRemotes` to
 * whatever `git remote` actually reports, and a project with no remotes — the
 * normal local-first case — never reaches this. Reaching it means remotes ARE
 * configured, and real dual-remote push lives in `@dokima/forge`, which is not
 * a declared dependency of `apps/server`. Refusing loudly is correct: silently
 * returning success would report a push that never happened.
 */
const localFirstPushToRemotes: PushToRemotesFn = () => {
  throw new Error(
    'dual-remote push is not wired into the CLI yet (@dokima/forge is not an ' +
      'apps/server dependency) — the ticket landed locally and was NOT pushed',
  );
};
