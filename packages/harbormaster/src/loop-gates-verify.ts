/**
 * Worktree/verify/git helpers for the out-of-session close gate
 * (`loop-gates.ts`). Split out per CODE_BOOK_PROTOCOL.md — see
 * `loop-gates-types.ts` for why this is a flat sibling file, not a
 * subdirectory.
 */

import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { git } from '@dokima/git';
import type { VerifyRunResult } from './loop-gates-types.js';

const execAsync = promisify(execCallback);

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
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: worktreePath,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { command, exitCode: 0, stdout, stderr };
  } catch (err) {
    const failure = err as { code?: unknown; stdout?: string; stderr?: string };
    const exitCode = typeof failure.code === 'number' ? failure.code : 1;
    return {
      command,
      exitCode,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
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
