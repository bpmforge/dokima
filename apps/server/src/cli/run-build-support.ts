/**
 * cli/run-build-support.ts — run scaffolding helpers (W16-04 chapter split,
 * CODE_BOOK_PROTOCOL 400-line cap): pure moves from `run-build.ts` — the
 * agent-runner resolution, the receipt count used by the signing-key mint
 * decision, and the dual-remote push binding.
 */
import {
  getEffectiveSettings,
  resolveEffectiveValue,
  type JsonValue,
} from '@dokima/shared';
import { pushToRemotes as forgePushToRemotes } from '@dokima/forge';
import { DEFAULT_AGENT_SESSION_TASK_TYPE, type PushToRemotesFn } from '@dokima/harbormaster';
import { ROLE_CODING_AGENT } from '@dokima/gateway';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';
import {
  preflightModelReachability,
  resolveModelTarget,
  type PinnedModel,
} from '../api/pipeline/model-resolution.js';
import {
  AGENT_RUNNER_SETTINGS_KEY,
  parseAgentRunnerSetting,
  type AgentRunnerSetting,
} from '../api/server/settings-types.js';
import type { RunCliIO } from './run-types.js';

/** Receipts already minted for this project — 0 means a new key invalidates nothing. */
export function countReceipts(log: {
  db: { prepare(q: string): { get(): unknown } };
}): number {
  const row = log.db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number };
  return row?.n ?? 0;
}

/**
 * `--agent-command` (run-scoped, explicit) wins outright over any stored
 * setting; absent, the effective project/global `agentRunner` setting
 * decides; absent THAT, the built-in default. Only resolves — never refuses
 * (an `external` row with an empty command is preserved for
 * `executeBuildRun` to refuse by name, W11-18).
 */
export async function resolveAgentRunner(
  io: RunCliIO,
  agentCommand: string | undefined,
): Promise<AgentRunnerSetting> {
  if (agentCommand) return { kind: 'external', command: agentCommand };
  const scoped = await getEffectiveSettings({ projectDir: io.cwd });
  const resolved = resolveEffectiveValue(AGENT_RUNNER_SETTINGS_KEY, scoped);
  return parseAgentRunnerSetting(resolved?.value as JsonValue | undefined);
}

/** W16-04 (FR-I2): the REAL dual-remote push — replaces the shim that threw
 * unconditionally. No remotes configured (local-first normal) never reaches
 * this; a failed remote is per-remote `ok:false`, recorded by the loop as a
 * ticket comment, never fatal (law 10). */
export const localFirstPushToRemotes: PushToRemotesFn = (options) =>
  forgePushToRemotes(options);

/**
 * W17-05: the CLI half of the model preflight — resolve the coding-agent
 * target the same way the spawn will, ask the provider one bounded
 * question, and refuse BEFORE any ticket is claimed. An unlisted-but-
 * healthy model warns and proceeds (LM Studio JIT-loads; proven live
 * 2026-08-21); unreachable refuses with the fix location named.
 */
export async function preflightBuiltInModel(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly pin?: PinnedModel;
}): Promise<
  | { readonly ok: true; readonly model: string; readonly warning?: string }
  | { readonly ok: false; readonly refusal: string }
> {
  let target;
  try {
    target = await resolveModelTarget({
      projectPath: input.cwd,
      role: ROLE_CODING_AGENT,
      taskType: DEFAULT_AGENT_SESSION_TASK_TYPE,
      actorId: input.actorId,
      ...(input.pin ? { pin: input.pin } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      refusal: err instanceof Error ? err.message : String(err),
    };
  }
  // Law 9a seam, mirroring the route's injected-config skip: an env-named
  // model is the tests/CI channel (the e2e fake gateway) — deliberate, and
  // owed no health contract.
  if (target.source === 'env') return { ok: true, model: target.model };
  const provider = await providerForConfig(targetToConfig(target, process.env));
  const preflight = await preflightModelReachability(provider, target.model);
  if (!preflight.ok) {
    return {
      ok: false,
      refusal:
        `the configured model "${target.model}" (provider ${target.providerId}) ` +
        `cannot be reached — ${preflight.reason}. Fix it under Settings -> Models; ` +
        `nothing was claimed.`,
    };
  }
  if (preflight.listed === false) {
    return {
      ok: true,
      model: target.model,
      warning:
        `the endpoint is reachable but does not list "${target.model}" — if it ` +
        `supports loading models on demand this will still work; otherwise pick ` +
        `a served model under Settings -> Models.`,
    };
  }
  return { ok: true, model: target.model };
}
