/**
 * The production tool runner and the install probe (W23-04), split out of
 * `security-checks.ts` under the 400-line CODE_BOOK_PROTOCOL cap when W23-51
 * added the baseline comparison. Extraction only: no behaviour changed in the
 * move, and `security-checks.ts` re-exports both names.
 */

import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import {
  runSandboxed,
  type SandboxContainerOptions,
  type SandboxProfile,
  type SandboxRunOptions,
  type SandboxRunResult,
} from './sandbox/index.js';
import type { RunSecurityChecksOptions } from './security-checks.js';

/**
 * The production runner: every tool executes inside the existing sandbox
 * (`runSandboxed`, SC-07/FR-I4), with its own deadline and the network flag
 * the policy decided — not one the tool asked for.
 *
 * A `SandboxUnavailableError` becomes a null exit code, which every adapter
 * reads as "did not run", so a host that cannot isolate reports UNAVAILABLE
 * rather than either crashing the run or — far worse — falling back to an
 * unsandboxed execution of a scanner over code an agent session just wrote.
 */
export interface SandboxedToolRunnerOptions {
  /** W23-54: `'process'` (default) or the opt-in `'container'` profile. */
  readonly profile?: SandboxProfile;
  readonly container?: SandboxContainerOptions;
  /** Injected in tests; production is `runSandboxed`. */
  readonly run?: (options: SandboxRunOptions) => Promise<SandboxRunResult>;
}

/** Where the container profile mounts the worktree (`sandbox/container.ts`). */
const CONTAINER_WORKDIR = '/work';

export function sandboxedToolRunner(
  runnerOptions: SandboxedToolRunnerOptions = {},
): RunSecurityChecksOptions['runTool'] {
  const profile = runnerOptions.profile ?? 'process';
  const run = runnerOptions.run ?? runSandboxed;
  return async (adapter, args, opts) => {
    const started = Date.now();
    try {
      /**
       * W23-54: UNDER THE CONTAINER PROFILE ONLY THE WORKTREE WAS MOUNTED, so
       * the pinned ruleset and the bundled scanner — host paths on the command
       * line — did not exist inside it. Each runtime-owned path is mounted
       * read-only at the path the command line uses, from its REAL path (on
       * the founder's machine ~/.dokima/rules/sast is a symlink, and a bind
       * mount of a link is a dangling link). The worktree argument itself is
       * the one host path that is not there: it lives at /work.
       */
      const inContainer = profile === 'container';
      const readOnlyMounts = inContainer
        ? await Promise.all(
            (opts.readOnlyPaths ?? []).map(async (target) => ({
              source: await realpath(target).catch(() => target),
              target,
            })),
          )
        : [];
      const argv = inContainer
        ? args.map((a) => (a === opts.cwd ? CONTAINER_WORKDIR : a))
        : args;
      const result = await run({
        cwd: opts.cwd,
        // Constants only. `adapter.executable` and `args` are this module's own
        // literals plus runtime-owned paths; no session output reaches here.
        command: [adapter.executable, ...argv].map(shellQuote).join(' '),
        allowNetwork: opts.allowNetwork,
        timeoutMs: opts.timeoutMs,
        ...(inContainer
          ? {
              profile,
              readOnlyMounts,
              ...(runnerOptions.container ? { container: runnerOptions.container } : {}),
            }
          : {}),
      });
      // `sh -c` answers a command the image does not have with 127. Said with
      // the reason, so NOT RUN names the container profile, not the tool.
      const stderr =
        inContainer && result.exitCode === 127
          ? `${result.stderr}\n(container profile: the image ${runnerOptions.container?.image ?? 'node:22-slim (the default)'} has no ${adapter.executable})`
          : result.stderr;
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      };
    } catch (err) {
      return {
        exitCode: null,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false,
        durationMs: Date.now() - started,
      };
    }
  };
}

/**
 * Single-quotes an argument for the sandbox's shell command string. The
 * sandbox takes a command line, not an argv, so the quoting has to happen
 * somewhere; doing it here — over constants and two runtime-owned paths —
 * keeps it out of every adapter and makes the one place auditable.
 */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./=:-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Whether an executable is on PATH. A miss is UNAVAILABLE, never a pass. */
export function executableIsInstalled(executable: string): boolean {
  const result = spawnSync('command', ['-v', executable], {
    shell: true,
    encoding: 'utf8',
  });
  return result.status === 0;
}
