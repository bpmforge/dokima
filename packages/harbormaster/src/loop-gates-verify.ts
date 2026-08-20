/**
 * Worktree/verify/git helpers for the out-of-session close gate
 * (`loop-gates.ts`). Split out per CODE_BOOK_PROTOCOL.md — see
 * `loop-gates-types.ts` for why this is a flat sibling file, not a
 * subdirectory.
 */

import { git } from '@dokima/git';
import { runSandboxed } from './sandbox/index.js';
import type { VerifyRunResult } from './loop-gates-types.js';

/**
 * Re-runs the TICKET's own verify command — never the manifest's claimed
 * `command`/`exit` (SC-02: an agent that returns `{command: 'true', exit:
 * 0}` in its manifest must not be able to substitute a no-op for the real
 * gate). A hang, spawn error, or non-numeric exit is always non-zero —
 * never silently treated as a pass.
 */
export async function reRunVerify(
  worktreePath: string,
  command: string,
  timeoutMs: number,
): Promise<VerifyRunResult> {
  /**
   * SANDBOXED (W13-25). This ran `child_process.exec` with a cwd and a timeout
   * and nothing else: the parent environment was inherited whole and the
   * network was open. SC-07 has claimed the opposite since W6-06 — cleaned
   * env, no network by default, validator executables under the same sandbox —
   * and `packages/harbormaster/src/sandbox/` implemented all of it and had
   * ZERO production callers, because W6-06's write_scope was the module and no
   * ticket ever owned a call site.
   *
   * Both properties were verified by running them here, not assumed: a fetch
   * inside the sandbox fails ENOTFOUND, and a secret placed in the parent
   * environment is not visible to the child.
   *
   * `SandboxUnavailableError` is NOT caught. Falling back to an unsandboxed
   * run would be exactly the silent degradation this ticket exists to remove —
   * the board would show a green it did not earn. `executeBuildRun` refuses at
   * startup instead, where a run can decline before claiming anything.
   */
  const result = await runSandboxed({ cwd: worktreePath, command, timeoutMs });
  return {
    command,
    // `null` is a spawn error the process never started for — never a pass.
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.timedOut
      ? `${result.stderr}\n[verify timed out after ${timeoutMs}ms]`
      : result.stderr,
  };
}


/** The ticket branch's real fork point from `baseRef`, immune to `baseRef` moving forward since the session started. */
export async function resolveForkPoint(
  worktreePath: string,
  baseRef: string,
): Promise<string> {
  const { stdout } = await git(worktreePath, ['merge-base', baseRef, 'HEAD']);
  return stdout.trim();
}

function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function commitsSince(
  worktreePath: string,
  base: string,
): Promise<string[]> {
  const { stdout } = await git(worktreePath, ['rev-list', `${base}..HEAD`]);
  return splitLines(stdout);
}

/** Files touched by real commits in `base..HEAD` — stricter than `computeChangedPaths` (excludes uncommitted/untracked). */
export async function filesChangedInRange(
  worktreePath: string,
  base: string,
): Promise<string[]> {
  const { stdout } = await git(worktreePath, ['diff', '--name-only', base, 'HEAD']);
  return splitLines(stdout);
}

/** Longest verify output fed back to a maker. A tail, not a dump: enough to diagnose, not enough to crowd out the ticket. */
export const VERIFY_TAIL_CHARS = 2_000;

/**
 * The tail of a failed verify's output, stderr first.
 *
 * Truncation is ANNOUNCED rather than silent: a model shown a fragment that
 * begins mid-sentence, with no sign anything was cut, will reason about the
 * fragment as if it were the whole failure.
 */
export function verifyFailureTail(verify: VerifyRunResult): string | null {
  const raw = (verify.stderr.trim() || verify.stdout.trim()).trim();
  if (!raw) return null;
  const clipped = raw.length > VERIFY_TAIL_CHARS;
  const tail = clipped ? raw.slice(-VERIFY_TAIL_CHARS) : raw;
  return [
    clipped
      ? `verify output (last ${VERIFY_TAIL_CHARS} characters — earlier output truncated):`
      : 'verify output:',
    tail,
  ].join('\n');
}
