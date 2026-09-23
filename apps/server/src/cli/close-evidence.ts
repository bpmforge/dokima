/**
 * close-evidence.ts — `dokima close` measures what it records (W23-42).
 *
 * LIVE, 2026-09-23 release review: `dokima close T --files x.txt --commits
 * deadbeef… --verify-cmd false` closed the ticket, and the receipt stored
 * `{"command":"false","exitCode":0}`. `--verify-exit` defaulted to 0, and
 * `closeTicket` trusts its caller structurally (it is sync and runs nothing),
 * so the CLI minted a receipt for a verify that never ran, a file that did not
 * have to exist and a commit that was not in the repo.
 *
 * FOUNDER DECISION, same day: a receipt must never record caller-asserted
 * evidence as verified. So the CLI measures every part it can, with the SAME
 * primitives the agent close gate uses — never a parallel verifier:
 *
 * - verify: `reRunVerify`, the sandboxed re-run `runCloseGate` uses, and the
 *   command is the TICKET's own `verify` when it declares one (SC-02: a
 *   caller's `true` must not stand in for it). Only a ticket that declares
 *   none runs the caller's `--verify-cmd`, and the receipt says whose it was.
 * - files: `classifyManifestFiles`, the gate's containment-checked stat —
 *   checked AFTER verify, because verify is arbitrary code that can change the
 *   tree (the gate's own TOCTOU ordering).
 * - commits: each SHA must resolve to a commit object in the project's repo.
 *
 * THE ONE THING THAT CANNOT BE MEASURED is a commit in a project with no git
 * repo. That close still proceeds — refusing it would make the CLI unusable
 * outside git — but the receipt marks the commits `caller_asserted`, so it
 * never reads as verified.
 *
 * NOT THE FULL CLOSE GATE. `runCloseGate` also diffs against a fork point,
 * runs the validator pack and mints a signed receipt; it needs a ticket
 * worktree, a base ref, a content pack and a signing key the CLI does not
 * have. This is the part of it that turns caller claims into measurements.
 */
import path from 'node:path';
import { git } from '@dokima/git';
import {
  classifyManifestFiles,
  isSandboxProfileAvailable,
  reRunVerify,
} from '@dokima/harbormaster';
import type { CloseEvidence, Ticket, VerifyResult } from '@dokima/tickets';
import { PROJECT_STATE_DIR } from './db.js';

/** The close gate's own verify ceiling (DEFAULT_VERIFY_TIMEOUT_MS, loop-gates-types.ts). */
const CLOSE_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

export interface CloseClaim {
  readonly files: readonly string[];
  readonly commits: readonly string[];
  /** The caller's `--verify-cmd` — run only when the ticket declares no verify of its own. */
  readonly verifyCommand: string;
}

export type MeasuredClose =
  | {
      readonly ok: true;
      readonly verify: VerifyResult;
      readonly evidence: CloseEvidence;
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * The project a CLI close is about: the directory holding `.dokima/state.db`
 * when the log lives there (the default, and `--project`), else `cwd` for an
 * explicit `--db` somewhere else.
 */
export function projectRootFor(dbPath: string, cwd: string): string {
  const stateDir = path.dirname(dbPath);
  return path.basename(stateDir) === PROJECT_STATE_DIR ? path.dirname(stateDir) : cwd;
}

async function isGitRepo(root: string): Promise<boolean> {
  try {
    const { stdout } = await git(root, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    // Not a repo (or no git at all): the commits cannot be checked, and the
    // caller records them as asserted rather than verified.
    return false;
  }
}

async function isCommit(root: string, sha: string): Promise<boolean> {
  // `--` guards a SHA spelled like a flag; `^{commit}` refuses a tree or blob.
  try {
    await git(root, [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${sha}^{commit}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Runs the verify, stats the files and resolves the commits; never trusts the claim. */
export async function measureCloseEvidence(
  root: string,
  ticket: Pick<Ticket, 'verify'>,
  claim: CloseClaim,
  timeoutMs: number = CLOSE_VERIFY_TIMEOUT_MS,
): Promise<MeasuredClose> {
  // SC-07 fails closed, exactly as a build run does (sandbox-preflight.ts):
  // verify is untrusted code, and running it unsandboxed would be a green the
  // receipt did not earn.
  if (!isSandboxProfileAvailable('process')) {
    return {
      ok: false,
      reasons: [
        'this host cannot sandbox a verify run (sandbox-exec on macOS, unshare on ' +
          'Linux), and close runs verify rather than taking its exit code on trust',
      ],
    };
  }
  const verifySource = ticket.verify ? 'ticket' : 'caller';
  const command = ticket.verify ?? claim.verifyCommand;
  const ran = await reRunVerify(root, command, timeoutMs);
  const reasons: string[] = [];
  if (ran.exitCode !== 0) {
    const whose = verifySource === 'ticket' ? "the ticket's own verify" : '--verify-cmd';
    reasons.push(
      `${whose} \`${command}\` was run and exited ${ran.exitCode} (verifyExit=${ran.exitCode})`,
    );
  }

  const { missing, symlinkEscapes } = await classifyManifestFiles(root, claim.files);
  if (missing.length > 0) {
    reasons.push(`file(s) not found in the project: ${missing.join(', ')}`);
  }
  if (symlinkEscapes.length > 0) {
    reasons.push(
      `file(s) resolve outside the project via a symlink and are refused: ${symlinkEscapes.join(', ')}`,
    );
  }

  let commits: CloseEvidence['commits'] = 'caller_asserted';
  if (await isGitRepo(root)) {
    commits = 'verified';
    const unknown: string[] = [];
    for (const sha of claim.commits) {
      if (!(await isCommit(root, sha))) unknown.push(sha);
    }
    if (unknown.length > 0) {
      reasons.push(
        `commit(s) not found in the project's git repo: ${unknown.join(', ')}`,
      );
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    verify: { command, exitCode: ran.exitCode },
    evidence: { verify: 'ran', verifySource, files: 'verified', commits },
  };
}
