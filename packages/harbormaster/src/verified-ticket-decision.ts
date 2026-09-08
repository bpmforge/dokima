/**
 * The post-close decision (W23-12, AB-12): verify, review, repair, and — when
 * every precondition holds — accept, so the ticket that depends on this one
 * can start while the run is still going.
 *
 * WHAT THE RUN DID BEFORE: landed every ticket it could, then reviewed at the
 * end. A dependent whose predecessor landed at minute two waited for the whole
 * run, because `depsDone` requires `done` and nothing became `done` until a
 * person opened the Decide card the next morning. A board of three dependent
 * tickets therefore took three runs and three human acceptances, whatever the
 * reviewer said about any of them.
 *
 * THE ANSWER IS NOT TO RELAX `depsDone`. Treating `in_review` as accepted so a
 * dependent can start would make the demo finish and destroy the meaning of
 * the state: a dependent would build on work nothing had checked. `done`
 * still means accepted; what changes is that a machine can now supply the
 * acceptance, under the conditions D-020 set, and the dependent unlocks
 * through the reflow that already exists.
 *
 * EVERY PRECONDITION IS THE POLICY'S, NOT THIS FILE'S. The judgement lives in
 * `decideMachineAccept` (W23-01), which refuses a missing reviewer, a maker
 * reviewing itself, a verdict that is not a confirmation, a review of source
 * that has since moved, a required check that did not pass, and a receipt that
 * no longer refers to the current head. This module's whole job is to put
 * TRUE FACTS in front of it — read from the ledger and the tree, never from a
 * component's account of itself (C-2) — and to re-read the two that can change
 * underneath it immediately before the accept.
 *
 * INCONCLUSIVE STAYS IN REVIEW. There is no branch here that turns "I could
 * not tell" into an acceptance, and a refusal is recorded with the rule id
 * that produced it so the Decide card can say which one.
 */

import { appendEvent, listEvents, type EventLog } from '@dokima/events';
import { acceptTicket, getTicket } from '@dokima/tickets';
import {
  decideApprovedBuildAction,
  type ApprovedBuildPolicy,
  type ApprovedBuildReviewFacts,
} from './approved-build-policy.js';
import type { AutonomyMode } from './autonomy.js';
import { ensureReviewerIdentity } from './review-decision.js';
import type { RepairTicketOutcome } from './build-repair-loop.js';
import { collectReviewEvidence } from './review-evidence.js';

/** Recorded for every post-close decision, accepted or not — the audit row a Decide card reads. */
export const VERIFIED_DECISION_EVENT = 'build.accept.decided';

export interface VerifiedTicketOutcome {
  readonly ticketId: string;
  readonly accepted: boolean;
  /** The policy row that fired. Two refusals for different reasons must not read the same. */
  readonly ruleId: string;
  readonly reason: string;
  readonly repair: RepairTicketOutcome | null;
}

/** The tree as it stands right now. Re-read immediately before the accept, never cached. */
export interface CurrentSource {
  readonly headCommit: string | null;
  readonly sourceDigest: string | null;
}

export interface VerifiedTicketOptions {
  readonly log: EventLog;
  readonly runId: string | null;
  readonly ticketId: string;
  /** The reconstructed approval, or null when this project never recorded one. */
  readonly policy: ApprovedBuildPolicy | null;
  /** The legacy autonomy dial, consulted by the policy only when there is no valid approval. */
  readonly mode: AutonomyMode;
  readonly currentInputDigest: string;
  /** Review and repair this ticket. Injected: models are apps/server's business (the W13-23 seam). */
  readonly repair: (ticketId: string) => Promise<RepairTicketOutcome | null>;
  /** The head and source digest of this ticket's worktree, read fresh each call. */
  readonly currentSource: () => Promise<CurrentSource>;
  readonly secretValues?: readonly string[];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The tree as it stands now, read by the CORE from the ticket's own worktree.
 * An INCOMPLETE bundle reports a null digest rather than a partial one: a
 * dirty or unreadable worktree must fail the freshness comparison, not sneak
 * past it with a digest of whatever could be read.
 */
export async function currentSourceOf(
  ticketId: string,
  worktreePath: string,
  secretValues: readonly string[] = [],
): Promise<CurrentSource> {
  const bundle = await collectReviewEvidence({
    ticketId,
    worktreePath,
    secretValues: [...secretValues],
  });
  return {
    headCommit: bundle.headCommit,
    sourceDigest: bundle.complete ? bundle.sourceDigest : null,
  };
}

/**
 * The review facts, folded out of the ledger. Latest-wins, like every other
 * projection here, and deliberately NOT taken from the reviewer's own report:
 * the events are what the runtime recorded, and a component must not be the
 * source of the facts used to judge it (C-2).
 */
export function reviewFactsFor(
  log: EventLog,
  ticketId: string,
  current: CurrentSource,
): ApprovedBuildReviewFacts {
  let verdict: ApprovedBuildReviewFacts['verdict'] = null;
  let reviewerIdentityId: string | null = null;
  let reviewerModelId: string | null = null;
  let makerModelId: string | null = null;
  let reviewedSourceDigest: string | null = null;
  let requiredChecksAllPassed = false;
  let receiptCommits: readonly string[] = [];
  let makerIdentityId: string | null = null;
  /** Anything that happened AFTER the verdict and outlives it (W23-08). */
  let invalidated = false;

  for (const event of listEvents(log)) {
    if (event.ticketId !== ticketId) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.eventType === 'ticket.closed') {
      makerIdentityId = event.actorId;
      const manifest = payload.manifest as { commits?: unknown } | undefined;
      const commits = Array.isArray(manifest?.commits)
        ? manifest.commits
        : Array.isArray(payload.commits)
          ? payload.commits
          : [];
      receiptCommits = commits.filter((c): c is string => typeof c === 'string');
      if (verdict !== null) invalidated = true;
    } else if (event.eventType === 'ticket.rejected') {
      if (verdict !== null) invalidated = true;
    } else if (event.eventType === 'review.verdict') {
      const raw = asString(payload.verdict);
      verdict =
        raw === 'CONFIRMED'
          ? 'confirmed'
          : raw === 'CONTRADICTED'
            ? 'rejected'
            : 'inconclusive';
      reviewerIdentityId = event.actorId;
      reviewerModelId = asString(payload.reviewerModel);
      makerModelId = asString(payload.makerModel);
      reviewedSourceDigest = asString(payload.sourceDigest);
      const checks = Array.isArray(payload.securityChecks) ? payload.securityChecks : [];
      // A check the runtime chose to run and then treats as optional exists to
      // be ignored: every one of them is required, and NOT_APPLICABLE is the
      // only non-pass that does not block (nothing was skipped that could have
      // been looked at).
      requiredChecksAllPassed = checks.every((c) => {
        const status = (c as { status?: unknown }).status;
        return status === 'passed' || status === 'not_applicable';
      });
      invalidated = false;
    } else if (
      event.eventType === 'review.skipped' ||
      event.eventType === 'review.bounced'
    ) {
      // A refusal with a reason is not a verdict, and must not read as one.
      verdict = null;
      reviewerIdentityId = null;
      reviewerModelId = null;
      reviewedSourceDigest = null;
      requiredChecksAllPassed = false;
    }
  }

  return {
    makerIdentityId,
    reviewerIdentityId,
    makerModelId,
    reviewerModelId,
    // An invalidated verdict is not a confirmation of the CURRENT work. Said
    // as `inconclusive` rather than left `confirmed` with a stale digest,
    // because the digest comparison alone cannot see a re-close.
    verdict: invalidated && verdict === 'confirmed' ? 'inconclusive' : verdict,
    reviewedSourceDigest,
    currentSourceDigest: current.sourceDigest,
    requiredChecksAllPassed,
    receiptFresh:
      current.headCommit !== null &&
      receiptCommits.length > 0 &&
      receiptCommits[receiptCommits.length - 1] === current.headCommit,
  };
}

/**
 * Reviews, repairs and — if the policy permits — accepts one just-closed
 * ticket. Returns the decision whether or not it accepted: a refusal that
 * leaves no row is a ticket that silently sat there.
 */
export async function verifyAndAcceptTicket(
  options: VerifiedTicketOptions,
): Promise<VerifiedTicketOutcome> {
  const { log, ticketId } = options;
  const reviewerActorId = ensureReviewerIdentity(log);
  const repair = await options.repair(ticketId);

  const decide = async (): Promise<{
    readonly action: string;
    readonly ruleId: string;
    readonly reason: string;
  }> =>
    decideApprovedBuildAction({
      situation: 'machine-accept',
      policy: options.policy,
      mode: options.mode,
      facts: {
        currentInputDigest: options.currentInputDigest,
        review: reviewFactsFor(log, ticketId, await options.currentSource()),
      },
    });

  let decision = await decide();
  if (decision.action === 'machine_accept') {
    /**
     * THE SECOND READ IS THE POINT, not belt and braces. The review turn and
     * the repair rounds take minutes, and nothing stops a person, a concurrent
     * berth or a session from committing during them. Deciding on facts read
     * before that window and accepting after it is exactly how a stale
     * approval gets reused (IMPLEMENTATION_PLAN §6).
     */
    decision = await decide();
  }

  const ticket = getTicket(log, ticketId);
  const accepted = decision.action === 'machine_accept' && ticket?.status === 'in_review';
  if (accepted) {
    // Under the REVIEWER identity: `acceptTicket` refuses the ticket's own
    // owner, so this path cannot be reached by the maker (C-4).
    acceptTicket(log, { ticketId, actorId: reviewerActorId }, { runId: options.runId });
  }
  appendEvent(
    log,
    {
      eventType: VERIFIED_DECISION_EVENT,
      actorId: reviewerActorId,
      ticketId,
      runId: options.runId,
      payload: {
        accepted,
        action: decision.action,
        ruleId: decision.ruleId,
        reason: decision.reason,
        status: ticket?.status ?? null,
        repair: repair ? { stop: repair.stop, rounds: repair.rounds } : null,
      },
    },
    { secretValues: [...(options.secretValues ?? [])] },
  );
  return {
    ticketId,
    accepted,
    ruleId: decision.ruleId,
    reason: decision.reason,
    repair,
  };
}
