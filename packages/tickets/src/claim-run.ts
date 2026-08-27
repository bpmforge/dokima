/**
 * claim-run.ts — a claim belongs to a RUN, not just an actor (W21-33).
 *
 * The live shape, from the vault project's ledger:
 *
 *   #1274  ticket.claimed   22:30:58   run-mtao40ub claims it
 *   #1275  ticket.started   22:30:58
 *   #1279  ticket.released  22:31:12   run-mtalpxhj's park releases it
 *   #1303  gate.receipt_minted 22:32:21  run-mtao40ub's gate PASSES
 *
 * A previous run parked fourteen seconds after a new run claimed the same
 * ticket, and its park handler released work it was no longer doing. The new
 * run then finished, passed verify, passed both validators, minted a real
 * signed close receipt — and could not close, because the ticket it had
 * claimed was back in `ready`. The receipt was orphaned and the ticket has
 * never closed, across the project's entire history.
 *
 * The missing concept is small and exact: ownership was per ACTOR. Both runs
 * used the identity `operator`, so `assertOwner` was satisfied for the stale
 * run and it passed every check the system had. W21-14 designed for the
 * opposite failure — a dead run leaving a claim behind — and this is the same
 * gap biting from the other side.
 *
 * Three constraints shape the guard, and each one rules out a simpler version:
 *
 *   - IT GUARDS `release`, NOT `close`. A run guard on close would be a NEW
 *     way for a valid signed receipt to fail to land, which is precisely the
 *     failure being fixed here.
 *   - STEALING STAYS POSSIBLE, EXPLICITLY. The watchdog and the orphaned-claim
 *     reclaim exist in order to release another run's claim. An unconditional
 *     guard would make a dead run's claim permanent — a worse failure than
 *     this one, because nothing would ever clear it. They pass `steal` with a
 *     reason, and the release event records both, so the ledger answers "who
 *     took this, and why".
 *   - AN ABSENT RUN ID FAILS OPEN. A person releasing a ticket through the API
 *     has no run and never will. With W21-32 stamping every loop-internal
 *     call, "no run id" now means "a human did this" unambiguously — so the
 *     guard has teeth exactly where runs are involved and stays out of the way
 *     everywhere else.
 */
import { TicketError } from './errors.js';
import type { Ticket } from './types.js';

/** What a caller must say to take a claim that belongs to a different run. */
export interface ClaimSteal {
  /** Why this release is legitimate despite another run holding the claim. Recorded on the event. */
  readonly reason: string;
}

export interface ReleaseGuardInput {
  readonly ticket: Ticket;
  /** The releasing caller's run, or null/undefined for a person. */
  readonly runId?: string | null;
  readonly steal?: ClaimSteal;
}

/**
 * What the release event should record about run ownership: `null` when there
 * is nothing to say, or the run this release took the ticket from.
 */
export interface StealRecord {
  readonly stolenFromRunId: string;
  readonly reason: string;
}

/**
 * Throws when a different run holds the claim and the caller did not say it
 * was stealing. Returns the steal record to fold into the event payload
 * otherwise — non-null only when a claim actually changed hands.
 */
export function assertReleaseRunOwnership(input: ReleaseGuardInput): StealRecord | null {
  const holder = input.ticket.claimRunId;
  const caller = input.runId ?? null;
  if (holder === null || caller === null || holder === caller) return null;
  if (!input.steal) {
    throw new TicketError(
      'STALE_RUN',
      input.ticket.id,
      `release refused: ticket ${input.ticket.id} was claimed by run ${holder} and ` +
        `run ${caller} is releasing it. A run that is no longer working a ticket ` +
        `must not return it to ready underneath the run that is — that orphans the ` +
        `close receipt the working run is about to mint. Pass an explicit steal ` +
        `reason if this release is deliberate (the watchdog and the orphaned-claim ` +
        `reclaim do).`,
    );
  }
  return { stolenFromRunId: holder, reason: input.steal.reason };
}
