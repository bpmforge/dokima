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

export interface RunSummaryCounts {
  readonly landed: number;
  readonly parked: number;
  /** Tickets sitting in `in_review` — finished work no machine will advance. */
  readonly awaitingAcceptance: number;
  readonly stopReason: string;
}

/**
 * The run's closing line. Names the waiting work and the verb that answers it
 * whenever there is any; says nothing extra when there is none.
 */
export function runSummaryLine(runId: string, counts: RunSummaryCounts): string {
  const head =
    `${runId} finished: ${counts.landed} landed, ${counts.parked} parked ` +
    `(stop: ${counts.stopReason})`;
  if (counts.awaitingAcceptance === 0) return head;
  const plural = counts.awaitingAcceptance === 1 ? 'ticket is' : 'tickets are';
  return (
    `${head}\n${counts.awaitingAcceptance} ${plural} finished and waiting on YOU — ` +
    `nothing in the product will move them further, because accepting work is a ` +
    `human verb (maker != verifier). Review them on the Decide card, or accept ` +
    `one from here with: dokima accept <ticketId> --actor <your-id>`
  );
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
    readonly attempts: readonly unknown[];
  }[],
  stopReason: string,
  awaitingAcceptance: number,
): void {
  for (const outcome of outcomes) {
    stdout(
      `${outcome.ticketId}: ${outcome.landed ? 'landed' : `parked (${outcome.parkedReason ?? 'unknown'})`}` +
        ` after ${outcome.attempts.length} attempt(s)`,
    );
  }
  stdout(
    runSummaryLine(runId, {
      landed: outcomes.filter((o) => o.landed).length,
      parked: outcomes.filter((o) => !o.landed).length,
      awaitingAcceptance,
      stopReason,
    }),
  );
}
