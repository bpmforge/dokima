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
 * `redactString` runs BOTH passes here (W11-14): the known-shape patterns
 * (`SECRET_PATTERNS`: gh/AWS/OpenAI-style keys, PEM blocks, DB connection
 * strings) plus the exact-value pass against `secretValues` — vault-
 * registered and `.env` secret values, the same set `renderHandoff` gets via
 * `collectSecretValues(vault, projectDir)` (`@dokima/shared`). The caller
 * (`gateway-session.ts`) collects that array once — collection is async,
 * this module stays sync — and passes it down through
 * `AgentSessionToolContext` (`tool-executor.ts`); omitted, `verifyTool`
 * still gets pattern-only redaction, never a crash.
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
function redactAndTruncate(
  text: string,
  secretValues: readonly string[],
): RedactedOutput {
  const redacted = redactString(text, secretValues);
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
  if (result.nothingStaged) {
    // W21-60: told apart from a scope violation because the fixes are
    // opposite — this one means "name the file you actually changed".
    return {
      ok: false,
      reason:
        `commit staged nothing: ${files.join(', ')} ${files.length === 1 ? 'has' : 'have'} ` +
        `no changes to commit. Name the file(s) you actually edited — a file you ` +
        `wrote earlier in this session and already committed will not stage again.`,
    };
  }
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
  secretValues: readonly string[] = [],
): Promise<unknown> {
  const result = await reRunVerify(cwd, verifyCommand, timeoutMs);
  const stdout = redactAndTruncate(result.stdout, secretValues);
  const stderr = redactAndTruncate(result.stderr, secretValues);
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
