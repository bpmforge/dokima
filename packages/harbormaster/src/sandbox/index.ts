/**
 * Execution sandbox (FR-I4, SC-07): dispatches a verify/test run to the
 * `'process'` (default) or `'container'` (opt-in, DEPLOYMENT.md §5)
 * profile. Whichever profile runs is exactly what a receipt should attest
 * to — `SandboxRunResult.profile` and `.networkAllowed` are the fields a
 * future close-gate wiring records onto the receipt payload (out of this
 * ticket's write-scope: `packages/harbormaster/src/sandbox/**` only).
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
  return profile === 'container'
    ? runInContainerSandbox(options)
    : runInProcessSandbox(options);
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
