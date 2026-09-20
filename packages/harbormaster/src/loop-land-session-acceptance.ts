/**
 * loop-land-session-acceptance.ts — did the session already finish? (W21-83)
 *
 * A session that returns no Completion Manifest ends `attemptOnce` early, and
 * the close gate never runs. That is the right shape — a session which cannot
 * report has failed the contract and must keep costing an attempt — but it
 * means the product never asks the one question that matters: is the work
 * actually done?
 *
 * LIVE, Tally PLAN-tally-01, a project created entirely in the browser. The
 * ticket parked "ladder attempt cap reached" while its acceptance criterion
 * passed on disk: `npm run build` exits 0 in the worktree, right now. The
 * histogram says how: 72 tool calls — read 37, commit 14, write 7, edit 6,
 * list 8, and `agent-session.verify` ZERO. The maker fixed the build,
 * committed it fourteen times, and never once ran the tool that would have
 * told it so. Its earlier verify calls had failed for reasons since fixed
 * (W21-74, W21-75) and it appears to have abandoned the tool.
 *
 * So the session did the work and did not find out, and the product could not
 * find out either. Three attempts recorded turns:40, completed:false — a
 * session that finished the job is indistinguishable from one that did
 * nothing, and the ticket re-parks forever.
 *
 * THIS RUNS THE CRITERIA THE CLOSE GATE WOULD HAVE RUN, ONCE, and nothing
 * else. It mints no receipt and changes no status: C-2 is untouched, because
 * only the close gate decides done. What it produced was a sentence for the
 * next attempt — "your criteria already pass; return the manifest" — which is
 * the difference between a retry that repeats the work and one that finishes
 * it.
 *
 * W23-35: A SENTENCE WAS NOT ENOUGH. Told exactly that, in the Vault runs of
 * 2026-09-18, neither rung returned the manifest either — a model that reasons
 * past one leash reasons past the instruction too, and the ticket parked with
 * the work done and the gate never run. So `deriveManifest` below turns the
 * sentence into an ACTION: the harness writes the claim itself, from git, and
 * hands it to the same unmodified close gate. C-2 still holds — the gate
 * decides, and it checks git exactly as it always did, because the manifest
 * was never the thing it trusted. `silentCompletionGap` survives for the
 * cases the derived path declines (see `gapsFrom` in loop-land-session.ts).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  runAcceptanceCriteria,
  type AcceptanceCriterionLike,
} from './loop-gates-acceptance.js';
import type { CompletionManifest } from './loop-gates-types.js';
import {
  commitsSince,
  filesChangedInRange,
  reRunVerify,
  resolveForkPoint,
} from './loop-gates-verify.js';
import { verifyCommandFor } from './verify-command.js';
import { agentAuthoredPaths } from './worktree-harness-paths.js';

/** What the criteria said about a session that could not report. */
export interface SilentCompletion {
  /** Every executable criterion passed, and at least one was executable. */
  readonly complete: boolean;
  /** The criteria that passed, for the sentence a person reads. */
  readonly passing: readonly string[];
}

export const NOTHING_TO_REPORT: SilentCompletion = { complete: false, passing: [] };

/**
 * Runs the ticket's acceptance criteria against the worktree a manifest-less
 * session left behind. A criterion that cannot be executed (prose) is not
 * evidence either way, so a ticket with no executable criteria reports
 * nothing rather than claiming completion it never checked.
 */
export async function silentCompletion(input: {
  readonly worktreePath: string;
  readonly criteria: readonly AcceptanceCriterionLike[];
  readonly timeoutMs: number;
}): Promise<SilentCompletion> {
  if (input.criteria.length === 0) return NOTHING_TO_REPORT;
  const outcome = await runAcceptanceCriteria(
    input.worktreePath,
    input.criteria,
    input.timeoutMs,
  );
  if (outcome.runs.length === 0) return NOTHING_TO_REPORT;
  const allPassed = outcome.runs.every((run) => run.exitCode === 0 && !run.ranNothing);
  if (!allPassed) return NOTHING_TO_REPORT;
  return { complete: true, passing: outcome.runs.map((run) => run.command) };
}

/**
 * The line that replaces "no Completion Manifest was returned" when the work
 * is demonstrably finished. Deliberately blunt about what is left, because
 * the failure mode it corrects is a model that re-does work it already did.
 */
export function silentCompletionGap(found: SilentCompletion): string | null {
  if (!found.complete) return null;
  return (
    `THE WORK APPEARS DONE AND WAS NEVER REPORTED. Every acceptance criterion ` +
    `for this ticket passes in the worktree as it stands: ` +
    `${found.passing.map((c) => `\`${c}\``).join(', ')}. Do NOT redo it. Check what ` +
    `is already committed, then reply with ONLY the Completion Manifest JSON — ` +
    `that is the single remaining step.`
  );
}

/**
 * The evidence line that says a human did not write this manifest (W23-35).
 *
 * `runCloseGate` copies `manifest.evidence` into the close receipt's payload
 * verbatim, so marking the derivation here puts it on the receipt without the
 * gate learning a new field — and a reader joining receipts can tell a session
 * that REPORTED from one that was REPORTED FOR by grepping one string.
 */
export const DERIVED_BY_HARNESS = 'derivedBy: harness';

/**
 * A manifest the harness derived from git, for a session that did the work and
 * never reported it (W23-35).
 *
 * THE 2026-09-18 SHAPE. Vault run 5: an MTPLX model deliberated in 24k–27k
 * token turns until the 5400 s leash fired on turn 28 of 40, and the coder rung
 * exhausted its tool budget — neither returned a Completion Manifest. Run 2 was
 * the same and is the clean evidence: the harness itself recorded every
 * acceptance criterion passing in the worktree, and the ticket parked anyway.
 * 181k completion tokens to land nothing the gate would have accepted.
 *
 * WHY THIS IS SAFE UNDER LAW 4. The manifest is the agent's CLAIM, and
 * `runCloseGate` has never trusted it: it re-runs the ticket's own verify (never
 * the claimed command or exit), re-runs every executable criterion, stats every
 * claimed file, and checks the claim against the REAL diff and commit set in
 * both directions (W11-13). A claim the harness derives FROM that same git
 * history is one the gate can verify at least as well as an agent's. Nothing
 * lands on the harness's word — it lands on the gate's, unchanged.
 *
 * WHAT IS DELIBERATELY NOT DERIVED. `memory_written[]` is omitted: the harness
 * cannot claim what it did not write. `role` is unset on the production land
 * path so R-G2 is inert there, and a caller that DOES pass a memory-eligible
 * role will see the gate refuse a derived manifest — correctly, and with the
 * real reason, rather than the harness inventing a memory id to get past it.
 */
export async function deriveManifest(input: {
  readonly worktreePath: string;
  readonly ticketId: string;
  readonly ticketVerify: string | null | undefined;
  readonly criteria: readonly AcceptanceCriterionLike[];
  readonly baseRef: string;
  readonly found: SilentCompletion;
  readonly timeoutMs: number;
}): Promise<CompletionManifest | null> {
  // Never for a session whose work did not demonstrably pass: `silentCompletion`
  // has already refused a failing criterion, one that ran nothing, and a ticket
  // with nothing executable to check.
  if (!input.found.complete) return null;

  let base: string;
  try {
    base = await resolveForkPoint(input.worktreePath, input.baseRef);
  } catch {
    // No fork point, no ground truth to derive from. The gate would report this
    // itself; deriving a manifest to make it say so costs a gate run for nothing.
    return null;
  }

  const commits = await commitsSince(input.worktreePath, base);
  if (commits.length === 0) return null;

  // Committed files only (`filesChangedInRange`), minus the harness's own
  // commits (W21-31) — the symmetric write-scope check refuses a claim
  // containing either, so deriving them would manufacture a refusal.
  const committed = agentAuthoredPaths(
    await filesChangedInRange(input.worktreePath, base),
  );
  const files = await presentOnDisk(input.worktreePath, committed);
  if (files.length === 0) return null;

  // The gate re-runs the ticket's verify and compares nothing to the claim, but
  // a derived claim should still be OBSERVED rather than asserted: run the same
  // command `verifyCommandFor` will hand the gate, and report what it returned.
  const verifyCommand = await verifyCommandFor(
    input.worktreePath,
    input.ticketVerify ?? null,
    input.criteria,
  );
  const verify = await reRunVerify(input.worktreePath, verifyCommand, input.timeoutMs);
  if (verify.exitCode !== 0) return null;

  return {
    ticket: input.ticketId,
    files,
    verify: { command: verifyCommand, exit: verify.exitCode },
    commits,
    evidence: [
      `${DERIVED_BY_HARNESS} — the session returned no Completion Manifest; this ` +
        `manifest was derived from git (${commits.length} commit(s) since ${base.slice(0, 12)}) ` +
        `after every executable acceptance criterion passed in the worktree`,
      ...input.found.passing.map(
        (command) => `acceptance criterion passed: \`${command}\``,
      ),
      `verify re-run by the harness: \`${verifyCommand}\` exited ${verify.exitCode}`,
    ],
  };
}

/** A file committed and then deleted is in the range diff and not on disk; the gate would refuse the claim, so it is never claimed. */
async function presentOnDisk(
  worktreePath: string,
  files: readonly string[],
): Promise<string[]> {
  const kept = await Promise.all(
    files.map(async (file) => {
      try {
        await fs.stat(path.join(worktreePath, file));
        return file;
      } catch {
        return null;
      }
    }),
  );
  return kept.filter((file): file is string => file !== null);
}
