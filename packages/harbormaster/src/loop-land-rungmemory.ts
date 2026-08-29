/**
 * loop-land-rungmemory.ts — a rung that already failed this ticket (W21-46).
 *
 * Run 26 climbed R1 → R2 for the first time: R1 spent forty turns and produced
 * no manifest, R2 produced one in eight. The ticket then parked at the cap and
 * returned to Ready — and the next run started it at R1 again, re-spending
 * those forty turns on the model this ticket had just defeated. Runs 28, 32
 * and 34 each paid that toll again.
 *
 * The ledger already knows. `escalation.rung_advanced` names the ticket, the
 * rung it left, and the evidence that made it climb. Nothing read it back when
 * the rung was chosen, so the loop rediscovered the same fact four times.
 * Same shape as W21-45 one level up: knowledge the product wrote down, not
 * consulted where it would pay.
 *
 * NOT "start at the highest rung ever reached" — that would defeat
 * cheapest-first (D-018) for a ticket whose R1 failure was a one-off, and
 * cheapest-first is the whole economic argument for the ladder.
 *
 * AND THE MEMORY MUST EXPIRE WHEN THE TICKET CHANGES, which is the half that
 * makes it safe. A ticket whose scope was widened (W21-27) or whose
 * dependencies were repointed (W21-51) is not the ticket that defeated R1 —
 * PLAN-vault-002 is the live proof: it beat R1 four times, then the founder
 * split it and gave it a working toolchain, and the cheap rung deserves a
 * fresh go at the smaller job. So only escalations SINCE the last change to
 * the ticket count.
 */
import { listEvents, type EventLog } from '@dokima/events';
import { commentTicket } from '@dokima/tickets';

/** Events that make a ticket materially different from the one that failed. */
const TICKET_CHANGED = new Set([
  'ticket.created',
  'ticket.scope_widened',
  'ticket.dependencies_retargeted',
  /**
   * W21-62: a brief changes the ticket as much as its scope does.
   *
   * W21-59 gave the founder a way to tell a maker something it could not
   * discover, and the whole point is that the next attempt knows more than the
   * last one did. Leaving that out of this set meant the cheap rung stayed
   * condemned for failing a version of the ticket that no longer existed —
   * exactly the mistake the expiry rule was written to prevent, missed for the
   * one channel added after it.
   *
   * Live: PLAN-vault-002a was briefed with the .ts import convention and then
   * the scrypt parameter constraint, and every run since has skipped
   * coder-next and gone straight to the slower reasoning model, which is the
   * one that then hit the 300s request ceiling.
   */
  'ticket.brief_set',
  /**
   * W21-71: a ticket whose acceptance criteria changed is asking for
   * different work, so the cheap rung has not failed THIS ticket. Same
   * reasoning as brief_set above, for the axis W21-50 tells a founder to fix.
   */
  'ticket.acceptance_retargeted',
]);

export interface RungMemory {
  /** Rungs that failed this ticket since it last changed, in the order they did. */
  readonly failed: readonly string[];
  /** The attempt index to begin at — 1 is cheapest-first, unchanged. */
  readonly startAttempt: number;
}

/**
 * What the ledger remembers about rungs for this ticket. `startAttempt` is
 * one past the number of rungs that have already failed it, so a ticket that
 * defeated R1 begins at the attempt that maps to R2.
 */
export function rungMemoryFor(log: EventLog, ticketId: string): RungMemory {
  const failed: string[] = [];
  for (const event of listEvents(log)) {
    if (event.ticketId !== ticketId) continue;
    if (TICKET_CHANGED.has(event.eventType)) {
      // The ticket changed: everything before this is about a different job.
      failed.length = 0;
      continue;
    }
    if (event.eventType !== 'escalation.rung_advanced') continue;
    const payload = event.payload as { fromRung?: unknown };
    const from = typeof payload.fromRung === 'string' ? payload.fromRung : null;
    if (from && !failed.includes(from)) failed.push(from);
  }
  return { failed, startAttempt: failed.length + 1 };
}

/**
 * The sentence a run prints when it skips a rung, so a person can see WHY it
 * did not start cheap — silence here would look like the ladder misbehaving.
 */
export function rungSkipNotice(ticketId: string, memory: RungMemory): string | null {
  if (memory.failed.length === 0) return null;
  return (
    `${ticketId} starts above ${memory.failed.join(', ')}: ` +
    `${memory.failed.length === 1 ? 'that rung has' : 'those rungs have'} already ` +
    `failed this ticket since it last changed (escalation.rung_advanced), and ` +
    `re-running them costs a full session to rediscover it. Change the ticket — ` +
    `widen its scope, repoint its dependencies, or brief it — and the cheap rung ` +
    `gets a fresh go at the new job.`
  );
}

/**
 * The starting attempt for this ticket, with the reason on the ticket when it
 * is not 1. Comments here rather than at the call site so `loop-land-ticket.ts`
 * stays under the 400-line cap and so the notice can never drift from the
 * decision it explains.
 */
export function startAttemptFor(
  log: EventLog,
  ticketId: string,
  actorId: string,
  runId: string | undefined,
): number {
  const memory = rungMemoryFor(log, ticketId);
  const notice = rungSkipNotice(ticketId, memory);
  if (notice) {
    commentTicket(log, { ticketId, actorId, body: notice }, { runId: runId ?? null });
  }
  return memory.startAttempt;
}

/**
 * The skipped-to rung cannot be REACHED, so use the one memory ruled out
 * (W21-63).
 *
 * Run 47: rung memory skipped R1 — coder-next, serving fine — to reach R2,
 * which could not load ("Failed to load model … Operation canceled"). The run
 * made ZERO tool calls. An available cheaper model sat unused while the ticket
 * got no session at all, which is strictly worse than not skipping.
 *
 * A rung that FAILED THE WORK and a rung that CANNOT BE REACHED are different
 * facts, and rung memory records only the first. `escalation.rung_advanced`
 * means "this rung was tried and was not enough"; it says nothing about
 * whether the rung above it exists today.
 *
 * KEYED ON THE RECORDED FAILURE KIND, never on the message text.
 * `runSessionAbsorbingProviderFailure` already returns
 * `infraFailure: 'endpoint_failure'` for exactly this case, so the distinction
 * is a value the loop is handed rather than a string it parses. (W21-64 does
 * match on a message, and the difference is that it classifies OUR OWN error
 * text; here a structured kind exists, so using prose would be a choice to be
 * less certain than the code already is.)
 *
 * Falls back ONCE. If the cheap rung then fails the work too, that is a real
 * verdict on the ticket and the ladder should park with it.
 */
export function rungFallbackNotice(ticketId: string, skipped: readonly string[]): string {
  const rungs = skipped.length > 0 ? skipped.join(', ') : 'the remembered rung';
  return (
    `${ticketId} is falling back to ${rungs}. The rung it skipped to could not be ` +
    `reached at all — the provider failed before the model could work, which is ` +
    `not the same as that rung failing this ticket. A session on a model memory ` +
    `had ruled out is worth more than no session, so the ladder is starting cheap ` +
    `again for the rest of this run.`
  );
}

/**
 * Comments the fallback and returns the rung offset that restarts the ladder
 * at its cheapest rung.
 *
 * NEGATIVE, and that is the whole subtlety. `beginRungAttempt` picks
 * `rungForAttempt(attempts.length + 1 + rungOffset)`, so the offset is
 * relative to how many attempts have already been judged — setting it to 0
 * does NOT go back to R1, it leaves the ladder exactly where the attempt
 * counter has already carried it. The first version of this fix returned 0
 * and the fixture caught it: R2 was asked five times and R1 never ran.
 *
 * `-(judged + 1)` cancels the attempts spent so far, so the NEXT attempt is
 * rung 1 and the ladder climbs from there normally — a rung that became
 * reachable again is still available, and cheapest-first is restored rather
 * than pinned.
 *
 * Lives here, next to the memory it overrides, so the notice cannot drift from
 * the decision and so `loop-land-ticket.ts` stays under the 400-line cap.
 */
export function fallBackToRememberedRung(
  /** Narrowed to what this needs, so the caller passes `options` unchanged. */
  options: { readonly log: EventLog; readonly actorId: string; readonly runId?: string },
  ticketId: string,
  /** Attempts already JUDGED when the fallback fires (W21-15's count, not the loop index). */
  judged: number,
): number {
  const { log, actorId, runId } = options;
  const memory = rungMemoryFor(log, ticketId);
  commentTicket(
    log,
    { ticketId, actorId, body: rungFallbackNotice(ticketId, memory.failed) },
    { runId: runId ?? null },
  );
  return -(judged + 1);
}
