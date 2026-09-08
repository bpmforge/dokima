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
  groupByOwner,
  type RawFinding,
  type RepairBatch,
  type RepairFinding,
  type TicketScope,
} from './repair-findings.js';
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

export type RepairStopKind =
  | 'confirmed'
  | 'exhausted'
  | 'no-progress'
  | 'infrastructure'
  | 'scope-conflict'
  | 'stopped';

export type RepairAction =
  | { readonly kind: 'repair'; readonly round: number }
  | { readonly kind: 'stop'; readonly stop: RepairStopKind; readonly reason: string };

export interface RepairFacts {
  readonly ticketId: string;
  /** The review's own verdict on whether this may be accepted without a person. */
  readonly eligible: boolean;
  /** Why not, in the review's words. The repairable statement when nothing structured was attributable. */
  readonly blockers: readonly string[];
  /** Checks that could not answer — a missing scanner, a dead endpoint, an errored run. */
  readonly infrastructure: readonly string[];
  readonly sourceDigest: string | null;
  readonly batch: RepairBatch;
  readonly rounds: readonly RepairRoundRecord[];
  readonly maxRounds: number;
}

/**
 * The signature two attempts are compared on. Finding identities when the
 * origins gave enough to have any, and the blocker sentences otherwise —
 * because the no-progress rule must stay alive on the path where a verdict
 * names no file, which is most of them today.
 */
export function attemptSignature(facts: {
  readonly findings: readonly RepairFinding[];
  readonly blockers: readonly string[];
}): readonly string[] {
  const ids = facts.findings.map((f) => f.id);
  return [...(ids.length > 0 ? ids : facts.blockers)].sort();
}

function sameSignature(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * Whether to open another repair round. ORDER IS THE CONTRACT, and it is
 * fail-closed: every reason to stop is asked before the reason to spend.
 */
export function decideRepairAction(facts: RepairFacts): RepairAction {
  if (facts.eligible) {
    return { kind: 'stop', stop: 'confirmed', reason: 'the review confirmed this work' };
  }
  if (facts.infrastructure.length > 0) {
    return {
      kind: 'stop',
      stop: 'infrastructure',
      reason:
        `a check could not answer (${facts.infrastructure.join(', ')}) — that is not ` +
        `the code being wrong, and a repair round against it would send a maker ` +
        `after a defect nobody has evidence of`,
    };
  }
  if (facts.batch.findings.length === 0 && facts.batch.outOfScope.length > 0) {
    return {
      kind: 'stop',
      stop: 'scope-conflict',
      reason:
        `every remaining finding is outside this ticket's approved write scope ` +
        `(${facts.batch.outOfScope.length}) — they are proposals for a person, and ` +
        `a repair round must never grant itself the file`,
    };
  }
  if (facts.batch.findings.length === 0 && facts.blockers.length === 0) {
    return {
      kind: 'stop',
      stop: 'no-progress',
      reason: 'the review is not eligible and named nothing that could be repaired',
    };
  }
  if (facts.rounds.length >= facts.maxRounds) {
    return {
      kind: 'stop',
      stop: 'exhausted',
      reason:
        `${facts.rounds.length} automatic repair round(s) have already been spent on ` +
        `this ticket, which is the bound — a restart does not refill it`,
    };
  }
  const signature = attemptSignature({
    findings: facts.batch.findings,
    blockers: facts.blockers,
  });
  const last = facts.rounds[facts.rounds.length - 1];
  if (
    last &&
    last.sourceDigest === facts.sourceDigest &&
    sameSignature(last.signature, signature)
  ) {
    return {
      kind: 'stop',
      stop: 'no-progress',
      reason:
        `the previous repair round changed neither the source nor what is wrong ` +
        `with it — two attempts producing the same unresolved findings over the ` +
        `same tree are not converging`,
    };
  }
  return { kind: 'repair', round: facts.rounds.length + 1 };
}

/**
 * The rejection reason the next maker attempt will read, built from the batch
 * that OWNS this ticket. It reaches the maker through the path W21-42 already
 * built: `latestRejectionReason` is consulted at rung zero and outranks a
 * playbook hit, so nothing new has to be threaded through the handoff.
 */
export function repairReason(
  ticketId: string,
  batch: RepairBatch,
  blockers: readonly string[],
): string {
  const mine = groupByOwner(batch).get(ticketId) ?? [];
  const lines = mine.map(
    (f) =>
      `- [${f.severity}] ${f.ruleId} at ${f.path}:${f.location} — ${f.title}` +
      (f.confidenceKind === 'review-hypothesis' ? ' (unconfirmed hypothesis)' : ''),
  );
  const parked =
    batch.outOfScope.length > 0
      ? [
          `Outside this ticket's write scope, so NOT yours to change and left as ` +
            `proposals: ${batch.outOfScope.map((f) => f.path).join(', ')}.`,
        ]
      : [];
  return [
    `The machine review sent this back. What is unresolved:`,
    ...blockers.map((b) => `- ${b}`),
    ...lines,
    ...parked,
  ].join('\n');
}

export interface RepairTicketInputs {
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
