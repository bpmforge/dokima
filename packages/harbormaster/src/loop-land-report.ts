/**
 * loop-land-report.ts — how a park explains itself.
 *
 * Chapter of `loop-land.ts`, split at the 400-line CODE_BOOK_PROTOCOL cap
 * (W13-29). The seam is real: this is "write down what happened so a person
 * can act on it", while `loop-land.ts` is the ladder that decides when there
 * is something to write down.
 *
 * Worth keeping together for a second reason. Until W13-29 this was the ONLY
 * place a failure summary was ever produced — computed at the end, for a
 * human, after the ladder was already spent. The maker never saw any of it,
 * which is why every retry rendered a byte-identical prompt.
 */
import { redactString } from '@dokima/shared';
import {
  renderDecideCard,
  tokenBoundaryDecideCard,
} from './loop-land-policy.js';
import type { LandAttempt, LandParkedReason } from './loop-land.js';

/** Matches `verifyFailureTail` (W13-30) rather than inventing a second budget. */
const SESSION_TAIL_CHARS = 2_000;

/**
 * Why a session ended without a manifest, in the session's own words (W13-41).
 *
 * MEASURED: a ticket ran on a local model, spent its whole 12-iteration tool
 * budget twice, and parked. The entire explanation the operator got was
 * `exitCode=1 no completion manifest returned`. The session had said exactly
 * why — "exceeded the per-session tool-iteration budget (12) without a
 * Completion Manifest (T-27)" — and this function threw it away. The remedy
 * is a real setting (`maxToolIterations`) that nobody could have known to
 * reach for, and the agent had in fact written correct scaffolding into the
 * worktree, so a run that was one setting away from working read as a flat
 * failure.
 *
 * This is W13-30's fix pointed at the human: the maker is now told HOW it
 * failed, and the operator was still told only THAT it did.
 *
 * Reads `session.output` — the thinking-stripped stdout+stderr the loop
 * already normalises (`packages/loop/src/session.ts`), so no `<think>` content
 * can reach the log through this path.
 *
 * REDACTED (Law 8, SC-06): this string is appended to the event log, which is
 * append-only — a secret that reaches it cannot be taken back out.
 *
 * Truncation is ANNOUNCED, for the same reason it is in `verifyFailureTail`:
 * a fragment beginning mid-sentence with no sign anything was cut gets read
 * as the whole failure.
 */
function sessionFailureTail(output: string): string | null {
  const raw = redactString(output).trim();
  if (!raw) return null;
  const clipped = raw.length > SESSION_TAIL_CHARS;
  const tail = clipped ? raw.slice(-SESSION_TAIL_CHARS) : raw;
  return clipped
    ? `${tail} (last ${SESSION_TAIL_CHARS} characters — earlier output truncated)`
    : tail;
}

export function attemptSummaryLine(attempt: LandAttempt, ceiling: number): string {
  const gateSummary =
    attempt.closeGate === null
      ? noManifestSummary(attempt)
      : attempt.closeGate.ok
        ? 'close gate passed'
        : `close gate refused: ${attempt.closeGate.reasons.join('; ')}`;
  return `attempt ${attempt.attempt}/${ceiling}: exitCode=${attempt.session.exitCode} ${gateSummary}`;
}

/**
 * A session that returned nothing to judge. When it explained itself, say so;
 * when it did not, the bare line is already the honest answer and adding
 * anything would be inventing a reason.
 */
function noManifestSummary(attempt: LandAttempt): string {
  const why = sessionFailureTail(attempt.session.output);
  return why === null
    ? 'no completion manifest returned'
    : `no completion manifest returned — ${why}`;
}

function parkHeader(reason: LandParkedReason, ceiling: number): string {
  switch (reason) {
    case 'locked_ceiling_reached':
      return `Parked with evidence — locked-mode convergence ceiling (${ceiling}) reached without a close (D-018). The ticket is back in Ready; the next run will retry it.`;
    case 'awaiting_escalation_token':
      return 'Parked with evidence — token-gated escalation boundary reached without an approval token (D-018, FR-N2). The ticket is back in Ready; approve the escalation to let the next run continue.';
    case 'no_progress':
      return 'Parked with evidence — two attempts produced the IDENTICAL gaps, so the ladder stopped rather than spending the rest of it on the same failure (BLUEPRINT §3.5). The ticket is back in Ready; the gaps below are what did not move.';
    case 'attempted_nothing':
      return 'Parked with evidence — the session made tool calls and changed NOTHING, so there is no work to judge and a further attempt would carry the same information (W21-44). The ticket is back in Ready; the tool histogram below is what it actually did.';
    default:
      return `Parked with evidence — ladder attempt cap (${ceiling}) reached without a close (FR-H1/H2). The ticket is back in Ready; the next run will retry it, and will likely park again unless the evidence below is addressed.`;
  }
}

export function parkComment(
  reason: LandParkedReason,
  ceiling: number,
  attempts: readonly LandAttempt[],
  decideCard: ReturnType<typeof tokenBoundaryDecideCard> | undefined,
  /** W21-15: absorbed infra retries — shown, but never counted against the cap. */
  absorbedInfraRetries = 0,
  /** W21-19: the cross-session repetition line, when there is one to report. */
  repetitionLine: string | null = null,
): string {
  /**
   * W13-63: "Parked", because that is what HAPPENS. This header said
   * "auto-blocked with evidence" while the park path below it calls
   * releaseTicket — status ready — so the comment and the board told a
   * novice two different stories, and the board's was "nothing happened".
   * The ticket returns to Ready ON PURPOSE (blocked has no exit verb; the
   * next run retries), and the words now say so.
   */
  /**
   * W21-44: every reason gets its own sentence. This was a three-way choice
   * with a CATCH-ALL else, so `no_progress` had been rendering as "ladder
   * attempt cap (2) reached" since W13-29 — a ticket that stopped after one
   * attempt reported a cap it never hit. `attempted_nothing` inherited the
   * same lie the moment it existed, which is how it was noticed: a live park
   * after ONE attempt announcing that the cap of two had been reached.
   *
   * A park comment is the founder's whole account of why a ticket stopped. It
   * naming the wrong mechanism is worse than it saying nothing.
   */
  const header = parkHeader(reason, ceiling);
  const lines = [
    header,
    ...attempts.map((attempt) => attemptSummaryLine(attempt, ceiling)),
  ];
  // W21-15: visible, because a ticket that took five passes to reach two
  // judged attempts should say so — but never folded into the attempt number,
  // which is what made the evidence read "attempt 5/2".
  if (absorbedInfraRetries > 0) {
    lines.push(
      `${absorbedInfraRetries} infrastructure retry(s) were absorbed and did NOT ` +
        `count against the cap — see the session.infra_retry events for what failed.`,
    );
  }
  if (repetitionLine) lines.push(repetitionLine);
  if (decideCard) lines.push('', renderDecideCard(decideCard));
  return lines.join('\n');
}
