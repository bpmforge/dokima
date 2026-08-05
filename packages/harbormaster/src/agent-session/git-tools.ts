/**
 * Git-backed handlers for the closed tool set's `commit` and `verify`
 * tools (`tools.ts`). Reuses `@dokima/git`'s `commitWithScopeCheck` (SC-01)
 * — the only thing that makes a session's edits durable — and
 * `loop-gates-verify.ts`'s `reRunVerify`, the same primitive
 * `runCloseGate` itself uses to re-run a ticket's verify command, so the
 * in-session signal and the out-of-session gate agree on what "running
 * verify" means.
 */

import { commitWithScopeCheck, type WorktreeHandle } from '@dokima/git';
import { reRunVerify } from '../loop-gates-verify.js';
import { normalizeRelPath } from './fs-tools.js';

const MAX_OUTPUT_CHARS = 4000;

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)`
    : text;
}

/** `commitWithScopeCheck` only reads `handle.path` — the ticket branch/id fields it never touches aren't available from a bare `cwd` (see gateway-session.ts's module header for why). */
function toWorktreeHandle(cwd: string): WorktreeHandle {
  return { repoRoot: cwd, path: cwd, branch: '', ticketId: '' };
}

export interface CommitToolArgs {
  readonly files: readonly string[];
  readonly message: string;
}

export async function commitTool(
  cwd: string,
  writeScope: readonly string[],
  args: CommitToolArgs,
): Promise<unknown> {
  if (args.files.length === 0) {
    return {
      ok: false,
      reason: 'commit requires at least one explicit file — never a wildcard',
    };
  }
  const files = args.files.map(normalizeRelPath);
  const result = await commitWithScopeCheck(toWorktreeHandle(cwd), {
    paths: files,
    message: args.message,
    writeScope: [...writeScope],
  });
  if (!result.committed) {
    return {
      ok: false,
      reason: 'commit refused: one or more files fall outside write_scope',
      violations: result.violations,
    };
  }
  return { ok: true, committed: true, files };
}

export async function verifyTool(
  cwd: string,
  verifyCommand: string,
  timeoutMs: number,
): Promise<unknown> {
  const result = await reRunVerify(cwd, verifyCommand, timeoutMs);
  return {
    ok: true,
    command: result.command,
    exitCode: result.exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
}
