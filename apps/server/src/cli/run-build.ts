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
 * Dokima's own gateway-backed agent session (D-023) when nothing was
 * configured at all — never a refusal for that case. This is that
 * session's first live production caller — `createGatewaySpawnSession`
 * (W11-02/03/11/12/14/16) existed only behind its own tests until now.
 * W11-18 (FR-H6): an explicitly-chosen `external` runner with an
 * empty/missing `command` is a different case — a misconfiguration, not an
 * absence — and `executeBuildRun` below refuses on it rather than silently
 * substituting the built-in agent.
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
import { type SpawnSession } from '@dokima/loop';
import {
  DEFAULT_MAX_SESSION_SECONDS,
  runLandLoop,
  type PushToRemotesFn,
} from '@dokima/harbormaster';
import { createPackedHandoffBuilder } from './handoff-context.js';
import { assertSandboxOrWaiver } from './sandbox-preflight.js';
import {
  resolveSigningKey,
  SigningKeyMissingError,
  SIGNING_KEY_REF,
} from './signing-key.js';

/** Receipts already minted for this project — 0 means a new key invalidates nothing. */
function countReceipts(log: { db: { prepare(q: string): { get(): unknown } } }): number {
  const row = log.db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number };
  return row?.n ?? 0;
}
import {
  buildBuiltInSpawn,
  createWatchedExternalSpawn,
} from './run-build-spawn.js';
import {
  ESCALATION_POLICY_SETTINGS_KEY,
  resolveRunLimits,
  resolvePinnedModel,
  resolvePolicyScope,
} from './run-build-policy.js';

import { ROLE_CODING_AGENT } from '@dokima/gateway';
import {
  AGENT_RUNNER_SETTINGS_KEY,
  EXTERNAL_AGENT_WARNING,
  parseAgentRunnerSetting,
  type AgentRunnerSetting,
} from '../api/server/settings-types.js';
import { ModelResolutionError } from '../api/pipeline/model-resolution.js';
import type { BuildRunCommand, RunCliIO } from './run-types.js';

/**
 * `--agent-command` (run-scoped, explicit) wins outright over any stored
 * setting — the same "most specific wins" shape `SCOPE_PRECEDENCE` uses one
 * level up. Absent, the effective project/global `agentRunner` setting
 * decides; absent THAT, `parseAgentRunnerSetting(undefined)` is the
 * built-in default. This function only resolves — it never itself refuses,
 * even when the resolved row is `external` with an empty `command`
 * (`parseAgentRunnerSetting` preserves that misconfiguration rather than
 * degrading it, W11-18); `executeBuildRun` below is what turns that row
 * into a refusal.
 */
/**
 * Splits an external agent command into argv, honouring single and double
 * quotes (W12-03). The previous `.split(' ')` mis-parsed any path or argument
 * containing a space — `/Applications/My Agent/bin/agent --flag` tokenized to
 * `/Applications/My` plus four bogus args, and the operator saw a spawn
 * failure naming a truncated path with nothing explaining why. On macOS,
 * `/Applications` paths with spaces are ordinary, so this was a confusing
 * refusal waiting to happen rather than an exotic case.
 *
 * NOT A SECURITY FIX, and the distinction matters: `createChildProcessSpawn`
 * passes an argv ARRAY to `node:child_process` spawn with no shell, so a
 * split token could never have become a second command. W11-20's
 * `parseAgentRunnerSetting` separately rejects shell metacharacters and caps
 * length, and **that constraint is untouched here** — supporting quotes is
 * not licence to relax it. This function only decides where argument
 * boundaries fall in a string that has already been accepted.
 *
 * A trailing unterminated quote yields the token as typed rather than
 * throwing: the caller's existing empty-command refusal is the honest place
 * for "that isn't a runnable command", and a parse error here would surface
 * as a stack trace instead of a named refusal.
 */
export function tokenizeAgentCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted string is a real, intentional argument.
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

async function resolveAgentRunner(
  io: RunCliIO,
  agentCommand: string | undefined,
): Promise<AgentRunnerSetting> {
  if (agentCommand) return { kind: 'external', command: agentCommand };
  const scoped = await getEffectiveSettings({ projectDir: io.cwd });
  const resolved = resolveEffectiveValue(AGENT_RUNNER_SETTINGS_KEY, scoped);
  return parseAgentRunnerSetting(resolved?.value as JsonValue | undefined);
}

/**
 * Resolves the project's secrets vault, or refuses (W12-02).
 *
 * This used to degrade to an empty vault on a `NoKeychainAdapterError`, on
 * the argument that "on such a platform `vault.register` would refuse the
 * same way, so no vault secret could ever have been stored to redact."
 * That argument is sound for a machine that has NEVER had a working store,
 * and wrong for the one path that matters: `resolveCredentialStore` also
 * accepts the encrypted-file backend behind `DOKIMA_NO_KEYCHAIN` +
 * `DOKIMA_VAULT_KEY` (P-003), so an operator on Linux CAN register secrets,
 * and `~/.dokima/vault.json` plus the project's name index then persist on
 * disk. A later run that does not carry those two variables — a service
 * unit, a cron entry, a different shell — lands here, degrades to an empty
 * list, and `collectSecretValues` hands the redaction layer nothing to
 * redact while the secrets are still very much registered. That is a silent
 * failure of the control W11-11/14/16/17 were four consecutive tickets
 * spent building, and it is the same class of failure the
 * `DOKIMA_SIGNING_KEY` check above refuses rather than papers over.
 *
 * So: refuse, and name the two variables that fix it — which is exactly
 * what `NoKeychainAdapterError`'s own message already tells the operator to
 * set. `.env` redaction (the other half of `collectSecretValues`) is
 * independent and unaffected, but it is not a substitute: it covers a
 * different secret source, so continuing on it alone would still ship an
 * unredacted vault secret.
 *
 * NOT distinguished here — "an empty vault because nothing was registered"
 * from "an empty vault we cannot read" — and that is a scope call, not an
 * oversight. The discriminator is the name index at
 * `<DOKIMA_HOME>/secrets/<projectId>/`, but `computeProjectId` and the index
 * filename are private to `packages/shared/src/secrets/vault.ts`; reaching
 * them means either widening that package's exports (outside this ticket's
 * write_scope) or re-deriving the project-id hash here, which is precisely
 * the declared-twice defect W12-01 exists to fix. A follow-up that exports a
 * `hasRegisteredSecrets(projectDir)` probe can soften this refusal to a
 * warning for projects that genuinely have none.
 */
function resolveVaultOrRefusal(
  projectDir: string,
): { ok: true; vault: ProjectSecretsVault } | { ok: false; reason: string } {
  try {
    return {
      ok: true,
      vault: createProjectSecretsVault(resolveCredentialStore(process.env), projectDir),
    };
  } catch (err) {
    if (err instanceof NoKeychainAdapterError) return { ok: false, reason: err.message };
    throw err;
  }
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
  /**
   * W12-43: resolved, and MINTED on a fresh install rather than demanded.
   * This used to read `process.env.DOKIMA_SIGNING_KEY` and refuse — an honest
   * refusal that a user could only satisfy from a terminal, for a secret only
   * `randomBytes` can sensibly produce. The env var still wins when set (the
   * CI seam), and the one case that still refuses is the dangerous one: a
   * project that already HAS receipts whose key has gone missing.
   */
  let signingKey: string;
  try {
    const receiptCount = countReceipts(log);
    const resolved = await resolveSigningKey({ receiptCount });
    signingKey = resolved.key;
    if (resolved.source === 'minted') {
      // Said once, on the run that creates it: a key now exists that backups
      // should carry, and nothing else will ever mention it.
      io.stderr(
        `${runId}: minted a receipt signing key and stored it in your keychain ` +
          `(ref ${SIGNING_KEY_REF}). Receipts signed with it verify only while ` +
          `it exists — include it when you back this machine up.`,
      );
    }
  } catch (err) {
    if (err instanceof SigningKeyMissingError) {
      io.stderr(`${runId} refused: ${err.message}`);
      return 2;
    }
    io.stderr(
      `${runId} refused: no signing key could be resolved — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }

  // Refuse rather than run with a redaction layer that has nothing to
  // redact (W12-02) — same shape as the signing-key refusal above, and for
  // the same reason: a control that silently covers nothing is worse than
  // one that stops.
  const vault = resolveVaultOrRefusal(io.cwd);
  if (!vault.ok) {
    io.stderr(
      `${runId} did not start: the secrets vault is unreadable, so registered ` +
        `project secrets cannot be enumerated and would reach the model ` +
        `unredacted (FR-S2/SC-06). Nothing was claimed. ${vault.reason}`,
    );
    return 2;
  }

  const secretValues = await collectSecretValues(vault.vault, io.cwd);

  // W13-25: SC-07 fails closed — see `sandbox-preflight.ts`.
  if (!assertSandboxOrWaiver(log, command.actorId, runId, io)) return 2;

  // W12-18: the policy the user chose, read for the first time.
  const policyScoped = await getEffectiveSettings({ projectDir: io.cwd });
  const policyRaw = resolveEffectiveValue(ESCALATION_POLICY_SETTINGS_KEY, policyScoped)
    ?.value as JsonValue | undefined;
  const policyResult = resolvePolicyScope(policyRaw, ROLE_CODING_AGENT);
  if ('refusal' in policyResult) {
    io.stderr(`${runId} did not start: ${policyResult.refusal}`);
    return 2;
  }

  const pin = resolvePinnedModel(policyRaw, ROLE_CODING_AGENT);

  // W13-11/43/47: the run's numeric bounds, resolved together and refused
  // rather than clamped — see `resolveRunLimits`.
  const limitsResult = resolveRunLimits(
    (key: string) => resolveEffectiveValue(key, policyScoped)?.value as JsonValue | undefined,
    DEFAULT_MAX_SESSION_SECONDS,
  );
  if ('refusal' in limitsResult) {
    io.stderr(`${runId} did not start: ${limitsResult.refusal}`);
    return 2;
  }
  const limits = limitsResult.limits;

  const agentRunner = await resolveAgentRunner(io, command.agentCommand);
  let spawn: SpawnSession;
  /**
   * Undefined on the external-agent path: there is no `Provider` to ask, so
   * the packer gets its documented conservative floor rather than a number
   * invented here (W12-04).
   */
  let contextWindowTokens: number | undefined;
  if (agentRunner.kind === 'external') {
    const [agentBin, ...agentArgs] = tokenizeAgentCommand(agentRunner.command ?? '');
    if (!agentBin) {
      io.stderr(
        `the "external" agent runner is misconfigured: its command is empty; ` +
          `nothing was claimed`,
      );
      return 2;
    }
    io.stderr(EXTERNAL_AGENT_WARNING);
    // W13-47: under the watchdog. This path used to wait on the child for as
    // long as that child ran — the only runner with no bound of any kind.
    spawn = createWatchedExternalSpawn({
      command: agentBin,
      args: agentArgs,
      maxSessionSeconds: limits.maxSessionSeconds,
    });
  } else {
    try {
      const builtIn = await buildBuiltInSpawn(
        log,
        command,
        runId,
        io,
        secretValues,
        pin,
        limits.maxIterations,
        limits.maxTurnTokens,
        limits.maxSessionSeconds,
      );
      spawn = builtIn.spawn;
      contextWindowTokens = builtIn.contextWindowTokens;
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
    // W12-04: the packed builder, not `defaultHandoffBuilder()`. Until this
    // ticket every ticket session received `ticket.interface ?? ticket.title`
    // as its entire context while FR-L5's Context Packer sat unreachable.
    policyScope: policyResult.scope,
    buildHandoff: await createPackedHandoffBuilder({
      repoRoot: io.cwd,
      modelWindowTokens: contextWindowTokens ?? 0,
      // W12-09: the run already holds the event log, and its `db` is the
      // sanctioned handle `packages/memory` expects a caller to supply — so
      // the code index lives in the project's own SQLite file rather than a
      // second store nobody backs up.
      codeIndexHandle: log.db,
    }),
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
