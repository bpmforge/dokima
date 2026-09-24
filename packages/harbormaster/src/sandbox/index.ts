/**
 * Execution sandbox (FR-I4, SC-07): dispatches a verify/test run to the
 * `'process'` (default) or `'container'` (opt-in, DEPLOYMENT.md §5)
 * profile. Whichever profile runs is exactly what a receipt should attest
 * to — `SandboxRunResult.profile` and `.networkAllowed` are the fields a
 * future close-gate wiring records onto the receipt payload (out of this
 * ticket's write-scope: `packages/harbormaster/src/sandbox/**` only).
 *
 * W23-57: NO PRODUCTION CALLER SELECTS `'container'`. Every door passes no
 * profile and gets `'process'`; a project whose settings ask for the container
 * is refused in `apps/server` (`sandbox-preflight.ts`) rather than given the
 * process profile silently. Selecting it per project is W23-60.
 */

import { isContainerRuntimeAvailable, runInContainerSandbox } from './container.js';
import { isProcessSandboxAvailable, runInProcessSandbox } from './process.js';
import type { SandboxProfile, SandboxRunOptions, SandboxRunResult } from './types.js';

export type {
  SandboxContainerOptions,
  SandboxProfile,
  SandboxRunOptions,
  SandboxRunResult,
} from './types.js';
export { SandboxUnavailableError } from './types.js';
export { isContainerRuntimeAvailable, runInContainerSandbox } from './container.js';
export { isProcessSandboxAvailable, runInProcessSandbox } from './process.js';

/**
 * Runs `options.command` in `options.cwd` under `options.profile` (default
 * `'process'`). Throws `SandboxUnavailableError` if the requested profile
 * can't actually isolate the run on this host — see `process.ts`/
 * `container.ts` module docs for exactly what's probed and why.
 */
export async function runSandboxed(
  options: SandboxRunOptions,
): Promise<SandboxRunResult> {
  const profile = options.profile ?? 'process';
  if (profile === 'container') return runInContainerSandbox(options);
  // W23-44: the waiver applies only where isolation is genuinely unavailable.
  // It lifts the network denial — the one part that needs a platform wrapper
  // — and keeps everything else: the cleaned env, the process group, the
  // timeout. A host that CAN isolate is never affected by it.
  if (isUnsandboxedVerifyWaived()) {
    return runInProcessSandbox({ ...options, allowNetwork: true });
  }
  return runInProcessSandbox(options);
}

/**
 * W23-44: the DOKIMA_ALLOW_UNSANDBOXED_VERIFY waiver, as an explicit switch.
 *
 * The waiver was honoured at the build run's preflight — which appended
 * `sandbox.waived` and said "running verify UNSANDBOXED" — and nowhere after
 * it: every sandboxed call still went through the process profile's own
 * probe and threw `SandboxUnavailableError`. Proved by running it with
 * sandbox-exec off PATH before this was written.
 *
 * A switch rather than a parameter because the gate reaches this module from
 * ten call sites (the close gate's verify, the acceptance and base probes,
 * review, the security scanners); threading a flag through each would leave
 * the next new caller unwaived by default — the shape of the original defect.
 * This package never reads the environment: `apps/server` switches it on, and
 * only after recording the waiver (`sandbox-preflight.ts`) or putting it on
 * the close receipt (`close-evidence.ts`).
 */
let unsandboxedVerifyWaiver = false;

export function setUnsandboxedVerifyWaiver(on: boolean): void {
  unsandboxedVerifyWaiver = on;
}

/** True when a sandboxed run would actually run unisolated under the waiver. */
export function isUnsandboxedVerifyWaived(): boolean {
  return unsandboxedVerifyWaiver && !isProcessSandboxAvailable();
}

/**
 * True when the current host can actually run `profile` (network-isolation
 * mechanism present for `'process'`; a container runtime present for
 * `'container'`). Tests use this to skip real isolation checks rather than
 * fail on an environment gap that isn't this ticket's to fix — the same
 * pattern as CI's coverage job green-skipping on a missing devDep.
 */
export function isSandboxProfileAvailable(profile: SandboxProfile): boolean {
  return profile === 'container'
    ? isContainerRuntimeAvailable()
    : isProcessSandboxAvailable();
}
