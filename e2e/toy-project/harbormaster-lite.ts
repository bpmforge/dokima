/**
 * Out-of-session verify + receipt minting for the toy-project E2E harness
 * (FR-H1: "stat files + re-run verify", BLUEPRINT §3.9). This is a
 * deliberately minimal stand-in for the real Harbormaster (packages/
 * harbormaster, still a placeholder — W3-01, not a W1-07 dependency): it
 * never trusts the session-produced Completion Manifest directly (SC-02),
 * re-derives the truth from the worktree on disk and a real re-run of the
 * ticket's own canonical verify command (never the manifest's claimed
 * command — that's untrusted, attacker-controlled metadata, only ever
 * compared, never executed), and mints a durable, HMAC-anchored receipt
 * (@dokima/events `mintReceipt`) recording what it found — on both the
 * accept and the refusal path, so refusals carry a receipt too ("receipts
 * show why").
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  mintReceipt,
  type EventLog,
  type ReceiptInputFile,
  type ReceiptRecord,
  type ValidatorResult,
} from '../../packages/events/src/index.js';
import type { CompletionManifest } from '../../packages/loop/src/session-manifest.js';

const execFileAsync = promisify(execFile);

export interface ManifestVerification {
  readonly ok: boolean;
  /** Empty when ok; one entry per failed check when not. */
  readonly reasons: string[];
  readonly missingFiles: string[];
  readonly actualVerifyExit: number | null;
  readonly missingCommits: string[];
}

/**
 * Resolves a manifest-claimed (untrusted, session-produced — SC-02) path
 * against the worktree root, returning an absolute REAL path only when it stays
 * strictly inside `cwd` AND actually exists. Returns `null` (treated exactly
 * like a missing file — never stat'd for content, never read) for:
 *  - absolute paths and `..`-traversal (lexical escape);
 *  - **symlink escape**: a session can create a symlink inside its own scope
 *    (e.g. `src/leak.txt -> ~/.ssh/id_rsa`) — lexical containment passes but the
 *    real target is outside, so we resolve symlinks (`fs.realpath`) and re-check;
 *  - non-existent paths (`realpath` throws).
 * Law #8: a traversal/symlink-claimed secret must never be touched, let alone
 * hashed into the durable, HMAC-anchored event log (no UPDATE/DELETE — law #7,
 * so a leak could never be scrubbed).
 */
async function resolveInsideCwd(cwd: string, file: string): Promise<string | null> {
  if (path.isAbsolute(file)) return null;
  const root = await fs.realpath(path.resolve(cwd)).catch(() => null);
  if (root === null) return null;
  const lexical = path.resolve(root, file);
  if (lexical !== root && !lexical.startsWith(root + path.sep)) return null;
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    return null; // does not exist — treated as missing
  }
  if (real !== root && !real.startsWith(root + path.sep)) return null; // symlink escaped scope
  return real;
}

async function commitExists(cwd: string, sha: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', sha], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Splits a trusted command string into an argv array (quoted segments kept
 * intact) — never handed to a shell, so no metacharacter interpretation
 * happens even though this parser is deliberately simple.
 */
function tokenizeCommand(command: string): string[] {
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

/**
 * Re-runs the ticket's own canonical verify command for real, in the
 * worktree, capturing its actual exit code. Always `execFile` with an argv
 * array — never a shell — so no metacharacter interpretation occurs even
 * though this command is trusted (set by the maker identity at
 * ticket-creation time, not sourced from the session's manifest).
 */
async function runVerifyCommand(cwd: string, canonicalCommand: string): Promise<number> {
  const [cmd, ...args] = tokenizeCommand(canonicalCommand);
  if (!cmd) return 1;
  try {
    await execFileAsync(cmd, args, { cwd });
    return 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: number }).code;
    return typeof code === 'number' ? code : 1;
  }
}

/**
 * Re-derives ground truth for a Completion Manifest against the real
 * worktree: every claimed file must stat on disk, every claimed commit must
 * exist in git history, the manifest's claimed verify command must match the
 * ticket's own canonical verify command (`canonicalVerifyCommand`, looked up
 * by the caller from ticket state — never taken from the manifest itself),
 * and re-running that canonical command must reproduce the claimed exit
 * code. Never trusts `manifest` itself (SC-02) — every field here is
 * independently re-checked, and the manifest's `verify.command` is only ever
 * compared against the canonical command, never executed.
 */
export async function verifyManifestAgainstDisk(
  manifest: CompletionManifest,
  cwd: string,
  canonicalVerifyCommand: string,
): Promise<ManifestVerification> {
  const missingFiles: string[] = [];
  for (const file of manifest.files) {
    // A path that escapes the worktree (absolute or `..`-traversal) is never
    // stat'd — it is refused up front and counted as a missing file (SC-02,
    // law #8), so a malicious manifest can neither confirm a secret's
    // presence nor get it read into the receipt below.
    const abs = await resolveInsideCwd(cwd, file);
    if (abs === null) {
      missingFiles.push(file);
    }
  }

  const missingCommits: string[] = [];
  for (const sha of manifest.commits) {
    if (!(await commitExists(cwd, sha))) {
      missingCommits.push(sha);
    }
  }

  const reasons: string[] = [];
  if (missingFiles.length > 0) {
    reasons.push(
      `manifest claims file(s) not present on disk: ${missingFiles.join(', ')}`,
    );
  }
  if (missingCommits.length > 0) {
    reasons.push(
      `manifest claims commit(s) not present in worktree history: ${missingCommits.join(', ')}`,
    );
  }
  if (manifest.verify.command !== canonicalVerifyCommand) {
    reasons.push(
      `manifest claims verify command "${manifest.verify.command}" but the ` +
        `ticket's canonical verify command is "${canonicalVerifyCommand}"`,
    );
  }

  let actualVerifyExit: number | null = null;
  if (missingFiles.length === 0) {
    actualVerifyExit = await runVerifyCommand(cwd, canonicalVerifyCommand);
    if (actualVerifyExit !== manifest.verify.exit) {
      reasons.push(
        `verify re-run exit ${actualVerifyExit} does not match manifest's claimed exit ${manifest.verify.exit}`,
      );
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    missingFiles,
    actualVerifyExit,
    missingCommits,
  };
}

export interface MintVerificationReceiptInput {
  readonly id: string;
  readonly log: EventLog;
  readonly projectId: string;
  readonly ticketId: string;
  /** The trusted out-of-session identity minting this receipt (maker != verifier). */
  readonly actorId: string;
  readonly cwd: string;
  readonly manifest: CompletionManifest;
  /** The ticket's own canonical verify command (never the manifest's claimed one). */
  readonly canonicalVerifyCommand: string;
  readonly verification: ManifestVerification;
  readonly signingKey: string;
  readonly now?: () => string;
}

/** Reads the current on-disk content of every file the manifest claims exists, for the receipt's input-tree hash. */
async function readExistingFiles(
  cwd: string,
  files: readonly string[],
  missingFiles: readonly string[],
): Promise<ReceiptInputFile[]> {
  const missing = new Set(missingFiles);
  const result: ReceiptInputFile[] = [];
  for (const file of files) {
    if (missing.has(file)) continue;
    // Defense in depth: an out-of-worktree entry is already in `missingFiles`
    // (verifyManifestAgainstDisk refuses it before we get here), but never
    // read one even if a caller passes a stale/empty missing set — its content
    // must not reach the receipt's input-tree hash (law #8).
    const abs = await resolveInsideCwd(cwd, file);
    if (abs === null) continue;
    const content = await fs.readFile(abs, 'utf8');
    result.push({ path: file, content });
  }
  return result;
}

/**
 * Mints the durable receipt for one out-of-session verification pass:
 * `kind: 'close'` when the manifest checked out, `kind: 'gate'` (a refusal
 * receipt) when it did not — either way the receipt's validators + payload
 * carry the concrete reasons, so a refusal is never a silent throw with
 * nothing durable behind it. The receipt's `verifyCommand` records the
 * ticket's own canonical command that was actually executed, never the
 * manifest's claimed one.
 */
export async function mintVerificationReceipt(
  input: MintVerificationReceiptInput,
): Promise<ReceiptRecord> {
  const { verification } = input;
  const commandMatches = input.manifest.verify.command === input.canonicalVerifyCommand;
  const validators: ValidatorResult[] = [
    {
      name: 'file-stat',
      exitCode: verification.missingFiles.length === 0 ? 0 : 1,
      gapCount: verification.missingFiles.length,
    },
    {
      name: 'commit-exists',
      exitCode: verification.missingCommits.length === 0 ? 0 : 1,
      gapCount: verification.missingCommits.length,
    },
    {
      name: 'verify-command-matches-ticket',
      exitCode: commandMatches ? 0 : 1,
      gapCount: commandMatches ? 0 : 1,
    },
    {
      name: 'verify-rerun',
      exitCode: verification.actualVerifyExit === input.manifest.verify.exit ? 0 : 1,
      gapCount: verification.actualVerifyExit === input.manifest.verify.exit ? 0 : 1,
    },
  ];
  const inputFiles = await readExistingFiles(
    input.cwd,
    input.manifest.files,
    verification.missingFiles,
  );

  return mintReceipt(
    input.log,
    {
      id: input.id,
      kind: verification.ok ? 'close' : 'gate',
      projectId: input.projectId,
      ticketId: input.ticketId,
      validators,
      inputFiles,
      verifyCommand: input.canonicalVerifyCommand,
      verifyExit: verification.actualVerifyExit,
      actorId: input.actorId,
      payload: {
        reasons: verification.reasons,
        claimedFiles: input.manifest.files,
        claimedCommits: input.manifest.commits,
        claimedVerifyCommand: input.manifest.verify.command,
      },
    },
    { signingKey: input.signingKey, now: input.now },
  );
}
