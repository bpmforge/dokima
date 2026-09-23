/**
 * The production tool runner and the install probe (W23-04), split out of
 * `security-checks.ts` under the 400-line CODE_BOOK_PROTOCOL cap when W23-51
 * added the baseline comparison. Extraction only: no behaviour changed in the
 * move, and `security-checks.ts` re-exports both names.
 */

import { spawnSync } from 'node:child_process';
import { runSandboxed } from './sandbox/index.js';
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
export function sandboxedToolRunner(): RunSecurityChecksOptions['runTool'] {
  return async (adapter, args, opts) => {
    const started = Date.now();
    try {
      const result = await runSandboxed({
        cwd: opts.cwd,
        // Constants only. `adapter.executable` and `args` are this module's own
        // literals plus two runtime-owned paths; no session output reaches here.
        command: [adapter.executable, ...args].map(shellQuote).join(' '),
        allowNetwork: opts.allowNetwork,
        timeoutMs: opts.timeoutMs,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
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
