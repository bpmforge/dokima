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
  getEffectiveSettings,
  resolveAsset,
  resolveEffectiveValue,
  SECRET_PATTERNS,
  type JsonValue,
} from '@dokima/shared';
import { type SpawnSession } from '@dokima/loop';
import {
  DEFAULT_MAX_SESSION_SECONDS,
  runLandLoop,
  type LandLoopTicketOutcome,
  type LandRungSessions,
} from '@dokima/harbormaster';
import { createPackedHandoffBuilder } from './handoff-context.js';
import { assertSandboxOrWaiver } from './sandbox-preflight.js';
import {
  resolveSigningKey,
  SigningKeyMissingError,
  SIGNING_KEY_REF,
} from './signing-key.js';

import {
  announceRungSessions,
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
  EXTERNAL_AGENT_WARNING,
  MCP_SERVERS_SETTINGS_KEY,
  parseMcpServersSetting,
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
// Chapter of this file (W14-02, CODE_BOOK_PROTOCOL 400-line cap): a pure
// move; the re-export keeps every existing import site working.
import { tokenizeAgentCommand } from './agent-command.js';
export { tokenizeAgentCommand };
import { preloadMcpServers, type McpPreloadResult } from './mcp-preload.js';
import { composeExternalToolset } from './mcp-session-tools.js';
import { createLearningHook, createR0ConsultHook } from './memory-hooks.js';
import { FORGE_MIRROR_SETTINGS_KEY, setupForgeMirror } from './forge-mirror.js';
import { executeBerthsRun } from './run-build-berths.js';
import { executeReviewPass } from './review-pass.js';
import {
  MEMORY_CONSOLIDATION_SETTINGS_KEY,
  parseConsolidationEnabled,
  runPostRunConsolidation,
} from './consolidation.js';
import { syncMcpApprovalNotifications } from '../api/notifications/mcp-approvals.js';


// Chapter (W14-06, CODE_BOOK_PROTOCOL 400-line cap): the vault refusal
// moved verbatim to run-vault.ts.
import { resolveVaultOrRefusal } from './run-vault.js';
import {
  countReceipts,
  localFirstPushToRemotes,
  resolveAgentRunner,
} from './run-build-support.js';

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
    (key: string) =>
      resolveEffectiveValue(key, policyScoped)?.value as JsonValue | undefined,
    DEFAULT_MAX_SESSION_SECONDS,
  );
  if ('refusal' in limitsResult) {
    io.stderr(`${runId} did not start: ${limitsResult.refusal}`);
    return 2;
  }
  const limits = limitsResult.limits;

  /**
   * W14-02: preload configured MCP servers — the `mcpServers` key's first
   * reader. A malformed setting refuses the run (same posture as the
   * escalation policy above: a setting the user wrote deserves a named
   * refusal, not a silent skip); a server that fails to START only costs
   * itself (FR-G5). env refs resolve through the project vault (Law 8).
   */
  const mcpSetting = parseMcpServersSetting(
    resolveEffectiveValue(MCP_SERVERS_SETTINGS_KEY, policyScoped)?.value,
    (value) => SECRET_PATTERNS.some((p) => new RegExp(p.regex.source).test(value)),
  );
  if ('refusal' in mcpSetting) {
    io.stderr(`${runId} did not start: ${mcpSetting.refusal}`);
    return 2;
  }
  const mcpPreload: McpPreloadResult = await preloadMcpServers({
    log,
    actorId: command.actorId,
    runId,
    servers: mcpSetting.servers,
    resolveSecret: (name) => vault.vault.get(name),
    stderr: io.stderr,
    secretValues,
  });

  // W14-03: approvals a previous run parked get their Decide cards before
  // this run's sessions consult the queue's verdicts.
  syncMcpApprovalNotifications(log, command.actorId);

  // W16-04 (FR-T5): the Forge Mirror — config problems disable with a note.
  const forgeMirror = await setupForgeMirror({
    log,
    actorId: command.actorId,
    runId,
    settingRaw: resolveEffectiveValue(FORGE_MIRROR_SETTINGS_KEY, policyScoped)?.value,
    isSecretShaped: (value) =>
      SECRET_PATTERNS.some((p) => new RegExp(p.regex.source).test(value)),
    resolveSecret: (name) => vault.vault.get(name),
    secretValues,
    stderr: io.stderr,
  });

  const agentRunner = await resolveAgentRunner(io, command.agentCommand);
  let spawn: SpawnSession;
  // W15-01: the maker model, for the review pass's C-4 comparison. The
  // external-agent path cannot know its model — 'external-agent' is honest
  // and never collides with a real reviewer id.
  let makerModel = 'external-agent';
  // W16-01: the rung->session seam (built-in runner only — an external agent
  // owns its own model, so its ladder honestly retries the same runner), and
  // the models any rung actually ran, for review's C-4 refusal set.
  let rungSessions: LandRungSessions | undefined;
  let usedModels: () => readonly string[] = () => [];
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
        composeExternalToolset(log, ROLE_CODING_AGENT, mcpPreload),
      );
      spawn = builtIn.spawn;
      contextWindowTokens = builtIn.contextWindowTokens;
      makerModel = builtIn.makerModel;
      usedModels = builtIn.usedModels;
      // W16-01: the ladder's real shape said once at run start (FR-G5), and
      // the climb seam with its stderr notice — composed in the spawn chapter.
      rungSessions = announceRungSessions(builtIn, runId, io.stderr);
    } catch (err) {
      if (err instanceof ModelResolutionError) {
        io.stderr(`${runId} started, but the built-in agent refused: ${err.message}`);
        return 2;
      }
      throw err;
    }
  }

  const landOptions = {
      log,
      actorId: command.actorId,
      projectId: command.projectId,
      repoRoot: io.cwd,
      contentDir: resolveAsset('content', 'validators'),
      signingKey,
      spawn,
      // W12-04: the packed builder — FR-L5's Context Packer, live.
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
      // W16-01: present only on the built-in path — each real attempt runs
      // the session bound to its rung, and climbs are ledgered (FR-G3).
      ...(rungSessions ? { rungSessions } : {}),
      secretValues,
      // W14-05 + W16-03: learning producer + R0 consult, composed here (§4).
      attemptOutcome: createLearningHook({ log, secretValues, makerModel }),
      r0Consult: createR0ConsultHook({ log, actorId: command.actorId, secretValues }),
      ...(forgeMirror ? { verbMirror: forgeMirror.verbMirror } : {}),
      now: io.now,
    };
  // W16-02: the dial is read — N>1 drives the lane-aware berth engine over
  // the same one-ticket engine; N=1 keeps runLandLoop byte-identical.
  let result!: { processed: readonly LandLoopTicketOutcome[]; stopReason: string };
  try {
    result =
      (command.berths ?? 1) > 1
        ? await executeBerthsRun({
            log,
            runId,
            projectId: command.projectId,
            berths: command.berths!,
            landOptions,
            stderr: io.stderr,
          })
        : await runLandLoop(landOptions);
  } finally {
    // W14-03: this run's freshly parked approvals become Decide cards, so
    // the morning queue has them before anyone opens it.
    try {
      syncMcpApprovalNotifications(log, command.actorId);
    } finally {
      // Breach or not, no MCP child outlives the run (the W13-47 discipline).
      mcpPreload.dispose();
    }
  }

  // W15-01: the review pass — every in_review ticket gets a cross-model
  // verdict (or an honest skip) before a person reads the Decide card.
  await executeReviewPass({
    log,
    actorId: command.actorId,
    runId,
    repoRoot: io.cwd,
    makerModel,
    // W16-01: every model a rung session actually ran this run — the reviewer
    // must not match ANY of them (C-4 stays true when a ticket landed on R2).
    makerModels: [makerModel, ...usedModels()],
    secretValues,
    stderr: io.stderr,
  });

  // W14-06: the run's end is this product's idle moment — consolidate now
  // unless the project turned it off (US-603 AC-1; ON by default, FR-M3).
  runPostRunConsolidation({
    log,
    actorId: command.actorId,
    runId,
    enabled: parseConsolidationEnabled(
      resolveEffectiveValue(MEMORY_CONSOLIDATION_SETTINGS_KEY, policyScoped)?.value,
      io.stderr,
    ),
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

