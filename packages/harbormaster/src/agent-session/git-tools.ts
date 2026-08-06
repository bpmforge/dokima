/**
 * Git-backed handlers for the closed tool set's `commit` and `verify`
 * tools (`tools.ts`). Reuses `@dokima/git`'s `commitWithScopeCheck` (SC-01)
 * — the only thing that makes a session's edits durable — and
 * `loop-gates-verify.ts`'s `reRunVerify`, the same primitive
 * `runCloseGate` itself uses to re-run a ticket's verify command, so the
 * in-session signal and the out-of-session gate agree on what "running
 * verify" means.
 *
 * `verifyTool`'s output is appended to `messages` and sent to the routed
 * model on the next turn — possibly a cloud provider — so it goes through
 * `@dokima/shared`'s `redactString` (SC-06, the same layer `renderHandoff`
 * already runs over every handoff) before the existing MAX_OUTPUT_CHARS cap
 * is applied. Truncation alone is not redaction: it bounds size, not
 * secrecy.
 *
 * KNOWN LIMITATION: `redactString` runs here with no `secretValues` — only
 * the known-shape patterns (`SECRET_PATTERNS`: gh/AWS/OpenAI-style keys,
 * PEM blocks, DB connection strings) are caught, not vault-registered or
 * `.env` secret values (the exact-value pass `renderHandoff` gets via
 * `collectSecretValues(vault, projectDir)`). Threading `secretValues` here
 * would require a vault handle on `AgentSessionToolContext`
 * (`tool-executor.ts`), which is out of this ticket's `write_scope`.
 */

import { commitWithScopeCheck, type WorktreeHandle } from '@dokima/git';
import { redactString } from '@dokima/shared';
import { reRunVerify } from '../loop-gates-verify.js';
import { normalizeRelPath } from './fs-tools.js';

const MAX_OUTPUT_CHARS = 4000;

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)`
    : text;
}

interface RedactedOutput {
  readonly text: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
}

/**
 * Redacts before truncating (FR-S2, SC-06): a credential straddling the
 * MAX_OUTPUT_CHARS cut point must never leak half-matched, so `redactString`
 * runs over the full, untruncated command output and only the
 * already-redacted result gets capped.
 */
function redactAndTruncate(text: string): RedactedOutput {
  const redacted = redactString(text);
  return {
    text: truncate(redacted),
    redacted: redacted !== text,
    truncated: redacted.length > MAX_OUTPUT_CHARS,
  };
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
  const stdout = redactAndTruncate(result.stdout);
  const stderr = redactAndTruncate(result.stderr);
  return {
    ok: true,
    command: result.command,
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    // Honest-degrade (FR-S2, SC-06): this text is what reaches the routed
    // model's next turn (possibly a cloud provider) — say when something
    // was replaced or cut, rather than silently shortening it.
    redacted: stdout.redacted || stderr.redacted,
    truncated: stdout.truncated || stderr.truncated,
  };
}
