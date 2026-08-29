/**
 * run-summary.ts — what a run leaves behind, said honestly (W21-34).
 *
 * The live shape: a run landed PLAN-vault-001, its machine review was skipped
 * for want of a second model, and the run printed
 *
 *     run-… finished: 1 landed, 0 parked (stop: idle)
 *
 * and exited. Every word of that is true and the whole of it is misleading.
 * The ticket was sitting in `in_review`, where nothing in the product will
 * ever advance it — `accept` is a human verb by design (loop-review.ts is
 * explicit: "NOTHING HERE ACCEPTS"), and a founder driving from the terminal
 * was told neither that the work was waiting on them nor which verb answers
 * it. The CLI's own `--help` describes `dokima accept` perfectly. Nothing
 * pointed at it.
 *
 * So an autonomous run can land every ticket in a project and reach `done` on
 * none of them, reporting success each time. The fix is not to make the
 * machine accept — that would launder C-4. It is to stop describing a run as
 * finished when what it actually did was hand work back to a person.
 *
 * A pure function over counts: the summary is a sentence, and a sentence is
 * testable without a run.
 */

import { heldTicketsNotice } from '@dokima/harbormaster';

export interface RunSummaryCounts {
  readonly landed: number;
  readonly parked: number;
  /** Tickets sitting in `in_review` — finished work no machine will advance. */
  readonly awaitingAcceptance: number;
  readonly stopReason: string;
  /**
   * W21-40: tickets a run that has ended still holds. `stop: idle` reads
   * identically whether the board is empty or every remaining ticket is held
   * by a corpse, and that ambiguity hid this class three separate times.
   */
  readonly heldByEndedRuns?: readonly string[];
}

/**
 * The run's closing line. Names the waiting work and the verb that answers it
 * whenever there is any; says nothing extra when there is none.
 */
export function runSummaryLine(runId: string, counts: RunSummaryCounts): string {
  const head =
    `${runId} finished: ${counts.landed} landed, ${counts.parked} parked ` +
    `(stop: ${counts.stopReason})`;
  const held = heldTicketsNotice(counts.heldByEndedRuns ?? []);
  if (counts.awaitingAcceptance === 0) return held ? `${head}\n${held}` : head;
  const plural = counts.awaitingAcceptance === 1 ? 'ticket is' : 'tickets are';
  return (
    `${head}${held ? `\n${held}` : ''}` +
    `\n${counts.awaitingAcceptance} ${plural} finished and waiting on YOU — ` +
    `nothing in the product will move them further, because accepting work is a ` +
    `human verb (maker != verifier). Review them on the Decide card, or accept ` +
    `one from here with: dokima accept <ticketId> --actor <your-id>`
  );
}

/**
 * What to print inside `parked (…)` — W21-72.
 *
 * This was `outcome.parkedReason ?? 'unknown'`, and live on run 55 it printed
 * "PLAN-vault-002: parked (unknown) after 0 attempt(s)" while the ledger held
 * a complete, well-written explanation at the same moment. The reason was
 * never missing: parks raised BEFORE the first attempt discarded it when
 * building their outcome, so `defaultParkReason` (which only covers parks
 * after an attempt) never saw them.
 *
 * "unknown after 0 attempts" reads as the product malfunctioning, and it is
 * the first line a founder sees.
 *
 * Every park the product raises now carries a reason, so the fallback below is
 * unreachable by construction. It stays as a fallback rather than a
 * non-optional field because this function also renders outcomes read back
 * from an older log, where the field genuinely may be absent — and it says
 * "reason not recorded", which is true, instead of "unknown", which sounds
 * like the product does not know why it stopped.
 */
function parkedLabel(outcome: {
  readonly parkedReason?: string | null;
  readonly parkedDetail?: string | null;
}): string {
  const detail = outcome.parkedDetail?.trim();
  if (detail) {
    // First sentence only: the full text is already commented on the ticket,
    // and a summary line that wraps for a paragraph stops being a summary.
    const firstSentence = /^(.*?[.!?])(\s|$)/.exec(detail)?.[1] ?? detail;
    return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
  }
  return outcome.parkedReason ?? 'reason not recorded';
}

/**
 * Prints a finished run's per-ticket outcomes and its closing line. Lives here
 * rather than in `run-build.ts` because that file sits at the 400-line cap and
 * because reporting what a run did is one concern, not two.
 */
export function printRunOutcomes(
  stdout: (line: string) => void,
  runId: string,
  outcomes: readonly {
    readonly ticketId: string;
    readonly landed: boolean;
    readonly parkedReason?: string | null;
    /** W21-72: the written explanation a "cannot start" park already carries. */
    readonly parkedDetail?: string | null;
    readonly attempts: readonly unknown[];
  }[],
  stopReason: string,
  awaitingAcceptance: number,
  heldByEndedRuns: readonly string[] = [],
): void {
  for (const outcome of outcomes) {
    stdout(
      `${outcome.ticketId}: ${outcome.landed ? 'landed' : `parked (${parkedLabel(outcome)})`}` +
        ` after ${outcome.attempts.length} attempt(s)`,
    );
  }
  stdout(
    runSummaryLine(runId, {
      landed: outcomes.filter((o) => o.landed).length,
      parked: outcomes.filter((o) => !o.landed).length,
      awaitingAcceptance,
      stopReason,
      heldByEndedRuns,
    }),
  );
}
