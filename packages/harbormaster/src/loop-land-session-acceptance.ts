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
 * only the close gate decides done and a manifest is still required to reach
 * it. What it produces is a sentence for the next attempt — "your criteria
 * already pass; return the manifest" — which is the difference between a
 * retry that repeats the work and one that finishes it.
 */
import { runAcceptanceCriteria, type AcceptanceCriterionLike } from './loop-gates-acceptance.js';

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
