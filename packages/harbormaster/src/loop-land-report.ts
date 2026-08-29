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
import { listEvents, type EventLog } from '@dokima/events';
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
  const base =
    why === null
      ? 'no completion manifest returned'
      : `no completion manifest returned — ${why}`;
  /**
   * W21-83: the half of that ticket I shipped without. The maker was told its
   * criteria already passed; the PERSON reading the park was not, so a founder
   * looking at Tally saw "re-run it first" while `npm run build` had been
   * exiting 0 in the worktree for three runs. Advice to retry work that is
   * already finished is worse than no advice.
   */
  if (!attempt.silent?.complete) return base;
  return (
    `${base}. THE WORK IS ALREADY DONE THOUGH — every acceptance criterion ` +
    `passes in the worktree right now ` +
    `(${attempt.silent.passing.map((c) => `\`${c}\``).join(', ')}). ` +
    `The session finished the job and could not report it; the next attempt is ` +
    `told to return the manifest rather than redo the work.`
  );
}

/**
 * W21-58: every judged attempt died on the provider, so the ticket was never
 * really attempted.
 *
 * `runSessionAbsorbingProviderFailure` reports an endpoint failure as a null
 * exit code with an output that begins `provider failure:` — that is the
 * marker, and it is already on every attempt record.
 */
export function everyAttemptHitTheProvider(attempts: readonly LandAttempt[]): boolean {
  return (
    attempts.length > 0 &&
    attempts.every(
      (a) => a.session.exitCode === null && a.session.output.startsWith('provider failure:'),
    )
  );
}

/**
 * The reason to report when no earlier branch set one. Lives here with the
 * header it selects, so a new reason cannot be added in one place and rendered
 * as something else in the other — which is exactly how `no_progress` came to
 * print "ladder attempt cap reached" for two waves.
 */
/**
 * Every attempt died on a request TIMEOUT, not on a refusal (W21-64).
 *
 * Runs 48 and 49 died identically — reads and lists, then three
 * `provider failure: … request timed out after 300000ms`, no writes. W21-58
 * correctly parked them as `provider_unavailable` and told the founder to
 * check the endpoint, which was UP and answering. Finding the real cause took
 * hand measurement: 22 tok/s, a 4,475-token completion in the ledger, ~200s
 * — so a slightly longer one crosses a 300s ceiling. A reasoning model emits
 * completions that size routinely.
 *
 * Matched on our OWN message (`ProviderTimeoutError`), not a foreign one, so
 * this is a contract between two files in this repo rather than a guess about
 * a vendor's wording.
 */
const TIMEOUT_MARKER = /request timed out after (\d+)ms/;
/** The queue-wait timeout wears the same words; see `asProviderTimeout`. */
const QUEUE_WAIT_MARKER = /waiting for a request-queue slot/;

export function everyAttemptTimedOut(attempts: readonly LandAttempt[]): boolean {
  return (
    everyAttemptHitTheProvider(attempts) &&
    attempts.every((a) => TIMEOUT_MARKER.test(a.session.output))
  );
}

/** The ceiling the attempts actually ran into, read back from the message. */
export function observedTimeoutMs(attempts: readonly LandAttempt[]): number | null {
  for (const a of attempts) {
    const match = TIMEOUT_MARKER.exec(a.session.output);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

/**
 * A queue-wait timeout is NOT a slow model (W21-64 note). DEFAULT_QUEUE_ACQUIRE_MS
 * is also 300_000 and will present identically once berths > 1 put requests
 * behind a long reasoning turn — telling that founder to raise
 * `requestTimeoutMs` would send them to the wrong lever.
 */
export function timedOutWaitingForASlot(attempts: readonly LandAttempt[]): boolean {
  return (
    everyAttemptTimedOut(attempts) &&
    attempts.some((a) => QUEUE_WAIT_MARKER.test(a.session.output))
  );
}

/**
 * What the ledger can say about this ticket's turns (W21-64, W21-67).
 *
 * `spend.recorded` carries one event per metered call: token counts since
 * W13-24, and since W21-67 the provider-reported finish reason. Both numbers
 * a founder would otherwise derive by hand — a stopwatch on tokens/sec, then
 * a ledger read — are already written down.
 *
 * Read together because they answer one question between them: a park with
 * large completions AND length stops is a model being cut off mid-thought,
 * while large completions with natural stops is a model that simply thinks a
 * lot. Returning them separately invited a caller to report one without the
 * other and imply the wrong cause.
 */
export interface TicketLedgerEvidence {
  /**
   * LARGEST rather than total: the request ceiling is per CALL, so a sum would
   * answer a question nobody asked and make a run of many small calls look
   * like the problem.
   */
  readonly largestCompletionTokens: number | null;
  /** Turns the provider ended with `length` — cut off, not finished. */
  readonly lengthStops: number;
}

export function ledgerEvidenceFor(
  log: EventLog,
  ticketId: string,
  runId: string | null,
): TicketLedgerEvidence {
  let largestCompletionTokens: number | null = null;
  let lengthStops = 0;
  for (const event of listEvents(log)) {
    if (event.eventType !== 'spend.recorded') continue;
    if (event.ticketId !== ticketId) continue;
    if (runId !== null && event.runId !== runId) continue;
    const payload = event.payload as { completionTokens?: unknown; finishReason?: unknown };
    const tokens = payload.completionTokens;
    if (typeof tokens === 'number' && Number.isFinite(tokens)) {
      if (largestCompletionTokens === null || tokens > largestCompletionTokens) {
        largestCompletionTokens = tokens;
      }
    }
    if (payload.finishReason === 'length') lengthStops += 1;
  }
  return { largestCompletionTokens, lengthStops };
}

export function defaultParkReason(
  attempts: readonly LandAttempt[],
  mode: string,
): LandParkedReason {
  // Checked BEFORE the refusal case: a timeout is a provider failure too, so
  // the broader test would swallow it.
  if (everyAttemptTimedOut(attempts)) return 'provider_timeout';
  if (everyAttemptHitTheProvider(attempts)) return 'provider_unavailable';
  return mode === 'locked' ? 'locked_ceiling_reached' : 'ladder_exhausted';
}

function parkHeader(
  reason: LandParkedReason,
  ceiling: number,
  attempts: readonly LandAttempt[] = [],
  largestCompletionTokens: number | null = null,
): string {
  switch (reason) {
    case 'locked_ceiling_reached':
      return `Parked with evidence — locked-mode convergence ceiling (${ceiling}) reached without a close (D-018). The ticket is back in Ready; the next run will retry it.`;
    case 'awaiting_escalation_token':
      return 'Parked with evidence — token-gated escalation boundary reached without an approval token (D-018, FR-N2). The ticket is back in Ready; approve the escalation to let the next run continue.';
    case 'no_progress':
      return 'Parked with evidence — two attempts produced the IDENTICAL gaps, so the ladder stopped rather than spending the rest of it on the same failure (BLUEPRINT §3.5). The ticket is back in Ready; the gaps below are what did not move.';
    case 'attempted_nothing':
      return 'Parked with evidence — the session made tool calls and changed NOTHING, so there is no work to judge and a further attempt would carry the same information (W21-44). The ticket is back in Ready; the tool histogram below is what it actually did.';
    case 'provider_timeout': {
      // W21-64. The founder-facing gap: "the endpoint refused each request"
      // sends a person to check the endpoint. When every failure is a TIMEOUT
      // the sentence has to name the ceiling and what was observed against it,
      // because the product already holds both numbers and the alternative is
      // the founder measuring tokens/sec by hand — which is exactly what
      // diagnosing runs 48 and 49 cost.
      const limitMs = observedTimeoutMs(attempts);
      const limit = limitMs === null ? 'the configured ceiling' : `${limitMs}ms`;
      if (timedOutWaitingForASlot(attempts)) {
        return (
          `Parked — EVERY attempt timed out WAITING FOR A REQUEST SLOT, not on the model itself (${limit}). ` +
          `Another request was holding the endpoint. This is the queue-acquire bound, so raising ` +
          `\`requestTimeoutMs\` will not help; reduce concurrent berths or give the endpoint more capacity. ` +
          `The ticket is back in Ready.`
        );
      }
      const observed =
        largestCompletionTokens === null
          ? 'No completion size was recorded for this ticket, so the run has no measurement to offer.'
          : `The largest completion this ticket actually produced was ${largestCompletionTokens} tokens; ` +
            `at a local model's throughput that alone can exceed the ceiling.`;
      return (
        `Parked — EVERY attempt hit the request TIMEOUT (${limit}), not an endpoint refusal. ` +
        `The endpoint answered; it did not finish in time. ${observed} ` +
        `The lever is \`requestTimeoutMs\` on this provider's entry (Settings > Providers), ` +
        `which is generous for cloud latency and is a throughput assumption on local hardware. ` +
        `The ticket is back in Ready.`
      );
    }
    case 'provider_unavailable':
      return 'Parked with evidence — EVERY attempt failed before the model could work: the provider endpoint refused each request (W21-58). Nothing here is a judgement about this ticket or the model chosen for it. Check the endpoint is up and has a model loaded, then re-run; the ticket is back in Ready and its worktree still holds whatever earlier runs committed.';
    case 'cannot_start':
      // W21-72. Deliberately short: unlike every other reason here, this park
      // carries its own written explanation (`parkedDetail`), and repeating a
      // generic sentence above it would bury the specific one.
      return 'Parked before starting — the ticket could not be attempted at all. The reason is below; the ticket is back in Ready.';
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
  /**
   * W21-64/W21-67: what the ledger says about this ticket's turns. Passed in
   * rather than read here because this module is pure and the caller already
   * holds the log — a park comment that had to open a database to be written
   * would be a worse trade than one parameter.
   */
  evidence: TicketLedgerEvidence = { largestCompletionTokens: null, lengthStops: 0 },
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
  const header = parkHeader(reason, ceiling, attempts, evidence.largestCompletionTokens);
  const lines = [
    header,
    ...attempts.map((attempt) => attemptSummaryLine(attempt, ceiling)),
  ];
  // W21-15: visible, because a ticket that took five passes to reach two
  // judged attempts should say so — but never folded into the attempt number,
  // which is what made the evidence read "attempt 5/2".
  /**
   * W21-67: "is a thinking model being cut off before it does the work?" — the
   * question that could not be answered from the ledger at all. It is reported
   * for EVERY park reason, not just the timeout one: a session that produced
   * no manifest because each turn was truncated mid-thought looks identical,
   * from the outside, to a model that simply could not do the job.
   */
  if (evidence.lengthStops > 0) {
    lines.push(
      `${evidence.lengthStops} turn(s) were CUT OFF at the token ceiling ` +
        `(finish_reason: length), not ended by the model. A turn that stops ` +
        `mid-thought cannot produce a completion manifest, so this may be a ` +
        `budget symptom rather than a verdict on the ticket — see ` +
        `maxTurnTokens.`,
    );
  }
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
