/**
 * cli/run-build-preflight.ts — everything `executeBuildRun` checks before it
 * claims anything (W23-20, extracted during W23-06).
 *
 * EXTRACTION ONLY. Every block below is the one that was inline in
 * `run-build.ts`, in the same order, with the same messages and the same exit
 * code. What changed is that a refusal is now a returned value rather than a
 * `return 2` in the middle of a 400-line function.
 *
 * WHY IT MOVED, AND WHY THAT IS NOT A DETAIL. `run-build.ts` sat at exactly
 * 400 lines — the repo-wide `validate-file-size` cap — after W23-02 added one
 * preflight call. W23-20 was filed at that moment precisely because the next
 * card to touch this function would have no room and would be tempted to save
 * a line rather than make one. That card was W23-06, one card later.
 *
 * The order is load-bearing and unchanged: a signing key first (nothing may
 * mint an unverifiable receipt), then the vault (nothing may reach a model
 * unredacted), then the sandbox, then the policy the user chose, then the
 * numeric limits, then the approved-build check. Each refuses before the next
 * runs, so a run that cannot proceed says the FIRST true reason rather than
 * the last one anybody checked.
 */

import type { EventLog } from '@dokima/events';
import {
  collectSecretValues,
  getEffectiveSettings,
  resolveEffectiveValue,
  type JsonValue,
} from '@dokima/shared';
import { DEFAULT_MAX_SESSION_SECONDS } from '@dokima/harbormaster';
import { ROLE_CODING_AGENT } from '@dokima/gateway';
import { approvedBuildPreflight } from './approved-build.js';
import { countReceipts } from './run-build-support.js';
import { assertSandboxOrWaiver } from './sandbox-preflight.js';
import { signingKeyOrRefusal } from './signing-key.js';
import { resolveVaultOrRefusal } from './run-vault.js';
import {
  ESCALATION_POLICY_SETTINGS_KEY,
  resolveRunLimits,
  resolvePinnedModel,
  resolvePolicyScope,
  type RunLimits,
} from './run-build-policy.js';
import type { BuildRunCommand, RunCliIO } from './run-types.js';
import type { ApprovedBuildPolicy } from '@dokima/harbormaster';

export type BuildPreflight =
  | { readonly refused: number }
  | {
      readonly signingKey: string;
      readonly vault: Extract<ReturnType<typeof resolveVaultOrRefusal>, { ok: true }>;
      readonly secretValues: readonly string[];
      readonly policyScoped: Awaited<ReturnType<typeof getEffectiveSettings>>;
      readonly policyRaw: JsonValue | undefined;
      readonly pin: ReturnType<typeof resolvePinnedModel>;
      readonly limits: RunLimits;
      /** The resolved escalation policy scope the land loop is handed. */
      readonly policyScope: Extract<
        ReturnType<typeof resolvePolicyScope>,
        { scope: unknown }
      >['scope'];
      /** P6-05: the per-project landing mode, validated here and applied by the caller. */
      readonly landingMode: 'per-ticket' | 'per-feature';
      /** W23-12: the reconstructed approval, or null on a run nobody approved. */
      readonly approvedPolicy: ApprovedBuildPolicy | null;
    };

export async function runBuildPreflight(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
): Promise<BuildPreflight> {
  // W12-43: minted on a fresh install rather than demanded — see signing-key.ts.
  const keyResult = await signingKeyOrRefusal(countReceipts(log), runId, io.stderr);
  if ('refused' in keyResult) return { refused: 2 };
  const signingKey = keyResult.key;

  // W12-02: refuse rather than run with nothing to redact.
  const vault = resolveVaultOrRefusal(io.cwd);
  if (!vault.ok) {
    io.stderr(
      `${runId} did not start: the secrets vault is unreadable, so registered ` +
        `project secrets cannot be enumerated and would reach the model ` +
        `unredacted (FR-S2/SC-06). Nothing was claimed. ${vault.reason}`,
    );
    return { refused: 2 };
  }

  const secretValues = await collectSecretValues(vault.vault, io.cwd);

  // W13-25: SC-07 fails closed — see `sandbox-preflight.ts`.
  if (!assertSandboxOrWaiver(log, command.actorId, runId, io)) return { refused: 2 };

  // W12-18: the policy the user chose, read for the first time.
  const policyScoped = await getEffectiveSettings({ projectDir: io.cwd });
  const policyRaw = resolveEffectiveValue(ESCALATION_POLICY_SETTINGS_KEY, policyScoped)
    ?.value as JsonValue | undefined;
  const policyResult = resolvePolicyScope(policyRaw, ROLE_CODING_AGENT);
  if ('refusal' in policyResult) {
    io.stderr(`${runId} did not start: ${policyResult.refusal}`);
    return { refused: 2 };
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
    return { refused: 2 };
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
    return { refused: 2 };
  }
  const limits = limitsResult.limits;
  const approved = approvedBuildPreflight(log, command, runId, io); // W23-02
  if (approved.refused) return { refused: 2 };

  return {
    // W23-12: the reconstructed approval, carried rather than discarded — the
    // post-close accept seam is built only when there is one.
    approvedPolicy: approved.policy,
    signingKey,
    vault,
    secretValues,
    policyScoped,
    policyRaw,
    pin,
    limits,
    policyScope: policyResult.scope,
    landingMode: landingRaw === 'per-feature' ? 'per-feature' : 'per-ticket',
  };
}
