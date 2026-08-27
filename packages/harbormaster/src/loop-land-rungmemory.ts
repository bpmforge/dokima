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
    `widen its scope or repoint its dependencies — and the cheap rung gets a ` +
    `fresh go at the new job.`
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
