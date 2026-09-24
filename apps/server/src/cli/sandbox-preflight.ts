/**
 * sandbox-preflight.ts — SC-07 fails closed (W13-25).
 *
 * The close gate now runs every verify under the process sandbox: cleaned env,
 * network denied. Both properties were verified by running them, not assumed —
 * a fetch inside the sandbox fails `ENOTFOUND`, and a secret placed in the
 * parent environment is invisible to the child.
 *
 * A host that cannot isolate must not quietly run unsandboxed. The board would
 * then show a green it did not earn, which is worse than never having claimed
 * the control — and SC-07 claimed it, as landed, since W6-06, while
 * `packages/harbormaster/src/sandbox/` sat complete and callerless because that
 * ticket's write_scope was the module and no ticket ever owned a call site.
 *
 * Refused HERE rather than per-verify so a run declines before claiming a
 * ticket — the same shape as the signing-key and vault refusals beside it.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import {
  isSandboxProfileAvailable,
  sandboxedToolRunner,
  setUnsandboxedVerifyWaiver,
} from '@dokima/harbormaster';
import {
  getEffectiveSettings,
  resolveEffectiveValue,
  type ScopedSettings,
} from '@dokima/shared';
import type { RunCliIO } from './run-types.js';

/**
 * False when the run must refuse. The waiver is an explicit, RECORDED act
 * rather than a silent fallback: the refusal names it, and a run that uses it
 * appends `sandbox.waived` so the log says the gate ran without its isolation.
 */
export function assertSandboxOrWaiver(
  log: EventLog,
  actorId: string,
  runId: string,
  io: RunCliIO,
): boolean {
  if (isSandboxProfileAvailable('process')) return true;

  if (!unsandboxedWaiverRequested()) {
    io.stderr(
      `${runId} refused: this host cannot sandbox a verify run, and SC-07 ` +
        `requires one — verify commands and validator packs are untrusted code. ` +
        `Install the platform mechanism (sandbox-exec on macOS, unshare on ` +
        `Linux), or set DOKIMA_ALLOW_UNSANDBOXED_VERIFY=1 to accept running ` +
        `them with network access and no isolation (the environment is still ` +
        `cleaned). Nothing was claimed.`,
    );
    return false;
  }

  appendEvent(log, {
    eventType: 'sandbox.waived',
    actorId,
    runId,
    payload: { reason: 'no sandbox profile available on this host' },
  });
  // W23-44: and switch it on where the runs happen. Until then this function
  // recorded a waiver that no verify ever received — each one threw.
  setUnsandboxedVerifyWaiver(true);
  io.stderr(
    `${runId}: running verify UNSANDBOXED — this host has no isolation ` +
      `mechanism and DOKIMA_ALLOW_UNSANDBOXED_VERIFY is set. Recorded.`,
  );
  return true;
}

/**
 * W23-44: the one place the waiver variable is read. Build runs, `dokima
 * close` and the HTTP close all ask here, so the three doors cannot disagree
 * about whether it is set.
 */
export function unsandboxedWaiverRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.DOKIMA_ALLOW_UNSANDBOXED_VERIFY);
}

/** The settings key DEPLOYMENT.md §5 documented for choosing a sandbox profile. */
export const SANDBOX_SETTINGS_KEY = 'sandbox';

/**
 * W23-57: THE SETTING WAS READ NOWHERE. DEPLOYMENT.md §5 told a user to put
 * `sandbox: container` in project settings; no production caller passed a
 * profile, so every verify, gate and scan ran under the process profile
 * whatever the project chose — and said nothing.
 *
 * DEPRECATED TO A REFUSAL, NOT WIRED, and the reasons are recorded on the board
 * (W23-57) and carried by W23-60: the only selection pattern here is
 * process-global while one core serves many projects; wiring means threading a
 * profile through every sandboxed call site plus a receipt field that does not
 * exist; and a macOS worktree's native node_modules do not run in the default
 * Linux image. Until that lands, a project that asks for anything but the
 * process profile is REFUSED with this reason at every door that runs
 * sandboxed work for it — never quietly given the process profile instead.
 *
 * Returns null when the run may proceed (no setting, or `"process"`).
 */
export function sandboxSettingRefusalFrom(settings: ScopedSettings): string | null {
  const chosen = resolveEffectiveValue(SANDBOX_SETTINGS_KEY, settings)?.value;
  if (chosen === undefined || chosen === null || chosen === 'process') return null;
  const named =
    chosen === 'container' ? 'sandbox: container' : `sandbox: ${JSON.stringify(chosen)}`;
  return (
    `this project's settings choose \`${named}\`, and no run in this release ` +
    `executes under any profile but the process sandbox (SC-07) — the container ` +
    `profile is not selectable yet (W23-60). Refusing rather than running under ` +
    `the process profile in its place. Remove the "${SANDBOX_SETTINGS_KEY}" key ` +
    `from .dokima/settings.json (or set it to "process") to use the process sandbox.`
  );
}

/** `sandboxSettingRefusalFrom` over a project directory's effective settings. */
export async function sandboxSettingRefusal(projectDir: string): Promise<string | null> {
  return sandboxSettingRefusalFrom(await getEffectiveSettings({ projectDir }));
}

/**
 * A security-tool runner that runs nothing and says why (W23-57). Through
 * `sandboxedToolRunner`'s own error path, so every scanner reports UNAVAILABLE
 * with the refusal as its reason — coverage missing, never clean.
 */
export function refusedToolRunner(
  reason: string,
): ReturnType<typeof sandboxedToolRunner> {
  return sandboxedToolRunner({
    run: () => Promise.reject(new Error(reason)),
  });
}
