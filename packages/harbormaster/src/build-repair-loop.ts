/**
 * The bounded repair loop (W23-11, AB-11).
 *
 * WHAT THE PRODUCT DID BEFORE THIS: reviewed landed work, wrote a verdict on
 * the ticket, and stopped. A CONTRADICTED verdict left an `in_review` ticket
 * and a sentence, and the fix — reject, hand the judgement back, run the maker
 * again, re-verify — was a person's job every single time. `rejectTicket`
 * existed (W21-42) and the run never called it.
 *
 * SO THIS IS THE CYCLE, AND ITS BOUND IS THE POINT. An unbounded repair loop
 * is not a feature, it is a way to spend a night's tokens on a defect the
 * model cannot see. Three rounds by default; a caller may only TIGHTEN that,
 * never raise it, because the loop is spending someone else's budget.
 *
 * THE COUNT LIVES IN THE LEDGER, NOT IN THIS FUNCTION'S STACK. A counter held
 * in memory is reset by every restart, and a budget a restart can refill is
 * not a budget — it is a suggestion. Each round appends `build.repair.round`
 * before the reject that starts it, so a process that dies mid-repair comes
 * back having spent the round it spent.
 *
 * AN OUTAGE IS NOT A DEFECT. A scanner that is not installed, an endpoint that
 * is down, a check that errored — none of those are the code being wrong, and
 * turning one into a fix instruction sends a maker after a defect nobody has
 * evidence of. Those park with the true reason (IMPLEMENTATION_PLAN §7),
 * keeping the worktree and the evidence for whoever reads it next.
 *
 * NOTHING HERE WIDENS A TICKET. A finding outside every approved write scope
 * leaves as a proposal, exactly as `consolidateFindings` parked it.
 */

import { appendEvent, listEvents, type EventLog } from '@dokima/events';
import { rejectTicket } from '@dokima/tickets';
import {
  consolidateFindings,
  type RawFinding,
  type TicketScope,
} from './repair-findings.js';
import {
  attemptSignature,
  decideRepairAction,
  repairReason,
  type RepairAction,
  type RepairStopKind,
} from './build-repair-decide.js';

export {
  attemptSignature,
  decideRepairAction,
  repairReason,
} from './build-repair-decide.js';
export type { RepairAction, RepairFacts, RepairStopKind } from './build-repair-decide.js';
import { ensureReviewerIdentity } from './review-decision.js';

/** Three, from D-032 / IMPLEMENTATION_PLAN §7. A caller may lower it, never raise it. */
export const DEFAULT_MAX_REPAIR_ROUNDS = 3;

/** Appended BEFORE the reject that opens a round — a crash must not refund it. */
export const REPAIR_ROUND_EVENT = 'build.repair.round';
/** Appended when the loop stops, with the reason a person would need. */
export const REPAIR_STOPPED_EVENT = 'build.repair.stopped';

export interface RepairRoundRecord {
  readonly round: number;
  /** The tree this round was about. */
  readonly sourceDigest: string | null;
  /** What was unresolved when the round opened — identities, or blocker sentences when nothing structured was attributable. */
  readonly signature: readonly string[];
}

/**
 * Rounds already spent on this ticket, read back from the log.
 *
 * RESET BY AN ACCEPTANCE, and by nothing else. A ticket that was accepted and
 * later reopened is genuinely new work and deserves its own budget; a ticket
 * that merely failed again is the same defect and does not.
 */
export function recordedRepairRounds(
  log: EventLog,
  ticketId: string,
): readonly RepairRoundRecord[] {
  const rounds: RepairRoundRecord[] = [];
  for (const event of listEvents(log)) {
    if (event.ticketId !== ticketId) continue;
    if (event.eventType === 'ticket.accepted') {
      rounds.length = 0;
      continue;
    }
    if (event.eventType !== REPAIR_ROUND_EVENT) continue;
    const payload = event.payload as {
      round?: unknown;
      sourceDigest?: unknown;
      signature?: unknown;
    };
    rounds.push({
      round: typeof payload.round === 'number' ? payload.round : rounds.length + 1,
      sourceDigest:
        typeof payload.sourceDigest === 'string' ? payload.sourceDigest : null,
      signature: Array.isArray(payload.signature)
        ? payload.signature.filter((s): s is string => typeof s === 'string')
        : [],
    });
  }
  return rounds;
}

export interface RepairTicketInputs {
  /**
   * Set when there is no review to repair against — the ticket parked, or a
   * person already accepted it. NOT the same as eligible, and the difference
   * matters in an append-only log: recording "the review confirmed this work"
   * for a ticket no reviewer ever looked at is a claim the ledger keeps
   * forever, and a run lands parked tickets more often than not.
   */
  readonly notReviewable?: string;
  readonly eligible: boolean;
  readonly blockers: readonly string[];
  readonly infrastructure: readonly string[];
  readonly sourceDigest: string | null;
  readonly raw: readonly RawFinding[];
  readonly scopes: readonly TicketScope[];
  readonly verificationChecks: readonly string[];
}

export interface RepairLoopOptions {
  readonly log: EventLog;
  readonly runId: string | null;
  readonly ticketIds: readonly string[];
  /** Review the ticket as it stands now and report what is unresolved. */
  readonly inspect: (ticketId: string) => Promise<RepairTicketInputs>;
  /** Run the maker again on the rejected ticket. The reason reached it through the ledger. */
  readonly remake: (ticketId: string, reason: string) => Promise<void>;
  /** A caller may only TIGHTEN the bound — an existing session/token budget wins. */
  readonly maxRounds?: number;
  /** The run's own stop switch. Checked before every round; stopping schedules nothing new. */
  readonly stopped?: () => boolean | Promise<boolean>;
  readonly secretValues?: readonly string[];
}

export interface RepairTicketOutcome {
  readonly ticketId: string;
  readonly rounds: number;
  readonly stop: RepairStopKind;
  readonly reason: string;
  /** What the loop asked for, round by round — retained whether or not it worked. */
  readonly attempted: readonly string[];
  /** What is still wrong at the end. The artifact a person reads. */
  readonly remaining: readonly string[];
}

/**
 * Runs the bounded loop over each ticket in turn. ONE MAKER WRITER PER TICKET
 * is why this is sequential per ticket: two sessions repairing one worktree is
 * the collision the whole berth design exists to prevent.
 */
export async function runRepairRounds(
  options: RepairLoopOptions,
): Promise<readonly RepairTicketOutcome[]> {
  const reviewerActorId = ensureReviewerIdentity(options.log);
  const maxRounds = Math.min(
    DEFAULT_MAX_REPAIR_ROUNDS,
    options.maxRounds ?? DEFAULT_MAX_REPAIR_ROUNDS,
  );
  const outcomes: RepairTicketOutcome[] = [];
  for (const ticketId of options.ticketIds) {
    outcomes.push(await repairOne(options, ticketId, reviewerActorId, maxRounds));
  }
  return outcomes;
}

async function repairOne(
  options: RepairLoopOptions,
  ticketId: string,
  reviewerActorId: string,
  maxRounds: number,
): Promise<RepairTicketOutcome> {
  const attempted: string[] = [];
  for (;;) {
    if (options.stopped && (await options.stopped())) {
      return finish(options, ticketId, attempted, [], {
        kind: 'stop',
        stop: 'stopped',
        reason: 'the run was stopped — the ticket keeps its worktree and its evidence',
      });
    }
    const inputs = await options.inspect(ticketId);
    if (inputs.notReviewable !== undefined) {
      // No event: nothing happened to this ticket, and the park that DID
      // happen is already in the log under its own name.
      return {
        ticketId,
        rounds: recordedRepairRounds(options.log, ticketId).length,
        stop: 'not-reviewed',
        reason: inputs.notReviewable,
        attempted,
        remaining: [],
      };
    }
    const batch = consolidateFindings({
      raw: [...inputs.raw],
      scopes: inputs.scopes,
      verificationChecks: inputs.verificationChecks,
    });
    const rounds = recordedRepairRounds(options.log, ticketId);
    const action = decideRepairAction({
      ticketId,
      eligible: inputs.eligible,
      blockers: inputs.blockers,
      infrastructure: inputs.infrastructure,
      sourceDigest: inputs.sourceDigest,
      batch,
      rounds,
      maxRounds,
    });
    const remaining = [
      ...inputs.blockers,
      ...batch.findings.map((f) => `${f.ruleId} at ${f.path}:${f.location}`),
    ];
    if (action.kind === 'stop') {
      return finish(options, ticketId, attempted, remaining, action);
    }

    const reason = repairReason(ticketId, batch, inputs.blockers);
    // BEFORE the reject, so a crash between the two costs the round rather
    // than refunding it. Over-counting is the safe direction for a bound.
    appendEvent(
      options.log,
      {
        eventType: REPAIR_ROUND_EVENT,
        actorId: reviewerActorId,
        ticketId,
        runId: options.runId,
        payload: {
          round: action.round,
          sourceDigest: inputs.sourceDigest,
          signature: attemptSignature({
            findings: batch.findings,
            blockers: inputs.blockers,
          }),
          blockers: inputs.blockers,
        },
      },
      { secretValues: [...(options.secretValues ?? [])] },
    );
    // Under the REVIEWER identity. `rejectTicket` refuses the ticket's own
    // owner, so a maker cannot reach this path by impersonation (C-4).
    rejectTicket(
      options.log,
      { ticketId, actorId: reviewerActorId, reason },
      { runId: options.runId },
    );
    attempted.push(reason);
    await options.remake(ticketId, reason);
  }
}

function finish(
  options: RepairLoopOptions,
  ticketId: string,
  attempted: readonly string[],
  remaining: readonly string[],
  action: Extract<RepairAction, { kind: 'stop' }>,
): RepairTicketOutcome {
  const rounds = recordedRepairRounds(options.log, ticketId).length;
  appendEvent(
    options.log,
    {
      eventType: REPAIR_STOPPED_EVENT,
      actorId: ensureReviewerIdentity(options.log),
      ticketId,
      runId: options.runId,
      payload: {
        stop: action.stop,
        reason: action.reason,
        rounds,
        attempted: attempted.length,
        remaining,
      },
    },
    { secretValues: [...(options.secretValues ?? [])] },
  );
  return {
    ticketId,
    rounds,
    stop: action.stop,
    reason: action.reason,
    attempted,
    remaining,
  };
}
