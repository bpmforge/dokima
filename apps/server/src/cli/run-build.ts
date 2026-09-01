/**
 * cli/run-build.ts — the build-mode run (W10-77, W11-04).
 *
 * Chapter of run-cmd.ts, split under the 400-line CODE_BOOK_PROTOCOL cap that
 * `validate-file-size` enforces repo-wide since W10-49.
 *
 * W11-04 (FR-H6, D-023): the agent that works the board is no longer a
 * required CLI flag with no default. `resolveAgentRunner` picks it —
 * `--agent-command` first, then the project/global `agentRunner` setting,
 * defaulting to `built-in`: Dokima's own gateway-backed agent session
 * (D-023, `createGatewaySpawnSession`'s first live production caller).
 * W11-18 (FR-H6): an explicitly-chosen `external` runner with an empty
 * `command` is a misconfiguration, not an absence — `executeBuildRun`
 * refuses on it rather than silently substituting the built-in agent.
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
  orphanedClaims,
  runLandLoop,
  type LandLoopResult,
  type LandRungSessions,
} from '@dokima/harbormaster';
import { createPackedHandoffBuilder } from './handoff-context.js';
import { ensureSessionActor } from './identity.js';
import { assertSandboxOrWaiver } from './sandbox-preflight.js';
import { signingKeyOrRefusal } from './signing-key.js';

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
} from '../api/server/settings-types.js';
import { ModelResolutionError } from '../api/pipeline/model-resolution.js';
import type { BuildRunCommand, RunCliIO } from './run-types.js';

/**
 * `--agent-command` (run-scoped, explicit) wins outright over the stored
 * `agentRunner` setting ("most specific wins", like `SCOPE_PRECEDENCE`);
 * absent both, built-in is the default. Resolution never itself refuses —
 * even an `external` row with an empty `command` (W11-18); `executeBuildRun`
 * below is what turns that row into a refusal.
 */
// Chapter of this file (W14-02, 400-line cap): a pure move, re-exported.
import { tokenizeAgentCommand } from './agent-command.js';
export { tokenizeAgentCommand };
import { preloadMcpFromSettings, type McpPreloadResult } from './mcp-preload.js';
import { composeExternalToolset } from './mcp-session-tools.js';
import { createLearningHook, createR0ConsultHook } from './memory-hooks.js';
import { FORGE_MIRROR_SETTINGS_KEY, setupForgeMirror } from './forge-mirror.js';
import { executeBerthsRun } from './run-build-berths.js';
import { executeReviewPass } from './review-pass.js';
import { printRunOutcomes } from './run-summary.js';
import { requiredValidatorsFor } from './run-validators.js';
import { listTickets } from '@dokima/tickets';
import {
  MEMORY_CONSOLIDATION_SETTINGS_KEY,
  parseConsolidationEnabled,
  runPostRunConsolidation,
} from './consolidation.js';
import { syncMcpApprovalNotifications } from '../api/notifications/mcp-approvals.js';

import { resolveVaultOrRefusal } from './run-vault.js';
import {
  countReceipts,
  localFirstPushToRemotes,
  preflightBuiltInModel,
  resolveAgentRunner,
} from './run-build-support.js';

/**
 * The build-mode run (W10-77): claim work off the board and actually do it.
 * Until W10-77, `run start --mode new_product` minted a run record and
 * returned — board unchanged, no session anywhere; the engine it needed
 * (`runLandLoop`, W3-01a/b/c) was exported from nothing until W10-78.
 */
export async function executeBuildRun(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
): Promise<number> {
  // W12-43: minted on a fresh install rather than demanded — see signing-key.ts.
  const keyResult = await signingKeyOrRefusal(countReceipts(log), runId, io.stderr);
  if ('refused' in keyResult) return 2;
  const signingKey = keyResult.key;

  // W12-02: refuse rather than run with nothing to redact.
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

  // P6-05 (Law L11): per-project landing mode, same generic settings surface
  // as `agentRunner`/`escalationPolicy`; default per-ticket (unchanged).
  const landingRaw = resolveEffectiveValue('landingMode', policyScoped)?.value;
  if (landingRaw != null && landingRaw !== 'per-ticket' && landingRaw !== 'per-feature') {
    io.stderr(
      `${runId} did not start: settings key "landingMode" must be "per-ticket" or ` +
        `"per-feature" (got ${JSON.stringify(landingRaw)}); nothing was claimed`,
    );
    return 2;
  }

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

  // W14-02: preload configured MCP servers — see mcp-preload.ts.
  const mcp = await preloadMcpFromSettings({
    log,
    actorId: command.actorId,
    runId,
    settingValue: resolveEffectiveValue(MCP_SERVERS_SETTINGS_KEY, policyScoped)?.value,
    isSecretLike: (value) =>
      SECRET_PATTERNS.some((p) => new RegExp(p.regex.source).test(value)),
    resolveSecret: (name) => vault.vault.get(name),
    stderr: io.stderr,
    secretValues,
  });
  if ('refusal' in mcp) {
    io.stderr(`${runId} did not start: ${mcp.refusal}`);
    return 2;
  }
  const mcpPreload: McpPreloadResult = mcp.preload;

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
    // W17-05: the model answers before any ticket is claimed.
    const preflight = await preflightBuiltInModel({
      cwd: io.cwd,
      actorId: command.actorId,
      ...(pin ? { pin } : {}),
    });
    if (!preflight.ok) {
      io.stderr(`${runId} refused: ${preflight.refusal}`);
      return 2;
    }
    if (preflight.warning) io.stderr(`${runId}: ${preflight.warning}`);
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

  // W21-38: which validators this project's close gate runs. Unset keeps the
  // built-in set, so an install that never touches it is unchanged.
  const validators = await requiredValidatorsFor(
    resolveAsset('content', 'validators'),
    (key) => resolveEffectiveValue(key, policyScoped)?.value as JsonValue | undefined,
  );
  if ('refusal' in validators) {
    io.stderr(`${runId} did not start: ${validators.refusal}`);
    return 2;
  }

  // W21-70: the SESSION verbs run as the machine, not as whoever launched
  // the run. `conflictWatch.humanActorId` below keeps the human where a human
  // is genuinely meant — the split this line completes.
  const sessionActorId = ensureSessionActor(log, io.now);
  const landOptions = {
    log,
    actorId: sessionActorId,
    projectId: command.projectId,
    // W21-32: in scope here all along, never passed — hence run=null events.
    runId,
    repoRoot: io.cwd,
    contentDir: resolveAsset('content', 'validators'),
    signingKey,
    spawn,
    // W12-04: the packed builder — FR-L5's Context Packer, live.
    policyScope: policyResult.scope,
    ...(validators.requiredValidators
      ? { requiredValidators: validators.requiredValidators }
      : {}),
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
    r0Consult: createR0ConsultHook({
      log,
      actorId: command.actorId,
      secretValues,
      runId,
    }),
    ...(forgeMirror ? { verbMirror: forgeMirror.verbMirror } : {}),
    ...(command.stopSwitch ? { stopSwitch: command.stopSwitch } : {}),
    conflictWatch: { humanActorId: command.actorId }, // W16-10 (FR-T6)
    now: io.now,
    // P6-05: chosen landing mode; omitted when per-ticket (pre-P6-05 shape).
    // Wired on the sequential path; the berth engine still lands per-ticket.
    ...(landingRaw === 'per-feature' ? { landing: 'per-feature' as const } : {}),
  };
  if (landingRaw === 'per-feature' && (command.berths ?? 1) > 1)
    io.stderr('per-feature awaits P6-11 on berths — landing PER-TICKET');
  let result!: Omit<LandLoopResult, 'stopReason'> & { stopReason: string };
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

  printRunOutcomes(
    io.stdout,
    runId,
    result.processed,
    result.stopReason,
    [...listTickets(log).values()].filter((t) => t.status === 'in_review').length,
    orphanedClaims(log, runId).map((o) => o.ticket.id), // W21-40: still held.
  );
  // P6-05: one honest line per feature — a park is never printed as a landing.
  for (const f of result.featureLandings ?? []) {
    io.stdout(
      `feature ${f.featureId}: ${f.landed ? f.detail : `NOT landed — ${f.detail}`}`,
    );
  }
  return 0;
}
