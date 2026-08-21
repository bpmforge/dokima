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
import type { PushToRemotesFn } from '@dokima/harbormaster';
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
