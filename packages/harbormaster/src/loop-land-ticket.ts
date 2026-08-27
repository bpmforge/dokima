/**
 * loop-land-ticket.ts — the one-ticket engine (W16-02 chapter split, under
 * the 400-line CODE_BOOK_PROTOCOL cap): the attempts ladder, the close
 * gate, the park, the push, and every injected seam (rung sessions, R0
 * consult, learning hook, verb mirror) for ONE claimed ticket.
 * `runLandLoop` (loop-land.ts) and `runBerths` (berths.ts, via
 * `landClaimedTicket`) are both thin schedulers over this same engine —
 * one sequential, one lane-aware-concurrent — so the two paths can never
 * drift apart in what a ticket run actually does.
 */
import { ROLE_CODING_AGENT } from '@dokima/gateway';
import { unsatisfiableCriteria, unsatisfiableNotice } from './loop-land-satisfiable.js';
import {
  attemptedNothingEndsTheLadder,
  latestSeq,
  parkIfAttemptedNothing,
} from './loop-land-attempted.js';
import type { WorktreeHandle } from '@dokima/git';
import {
  claimTicket,
  commentTicket,
  listTickets,
  releaseTicket,
  startTicket,
  TicketError,
  type Ticket,
} from '@dokima/tickets';
import { ceilingFor, createFreeRetryGate } from './loop-land-infra.js';
import { runAttemptOutcomeHook } from './loop-land-outcome.js';
import { parkComment } from './loop-land-report.js';
import { attemptOnce, nextFeedback } from './loop-land-session.js';
import {
  repeatedZeroInformationCalls,
  repetitionEvidenceLine,
} from './loop-land-repetition.js';
import {
  provisionWorktree,
  provisionFailureReason,
  provisionEnvironmentNote,
} from './worktree-provision.js';
import { pushLandedBranch, recordFailedPushes } from './land-push.js';
import {
  attemptNumberForRung,
  noopLandEscalationTokenHook,
  resolveLandEscalationPolicy,
  tokenBoundaryDecideCard,
} from './loop-land-policy.js';
import { beginRungAttempt, consultRungZero } from './loop-land-rungs.js';
import { startAttemptFor } from './loop-land-rungmemory.js';
import { fireVerbMirror } from './loop-land-verbs.js';
import {
  parkBeforeAttempting,
  requireTicket,
  resolveWorktree,
  StaleWorktreeError,
} from './loop-land-board.js';
import { activeLeases } from './conflict-leases.js';
import { runConflictWatch } from './conflict-watcher.js';
import type { AttemptFeedback } from './loop-handoff.js';
import type {
  LandAttempt,
  LandLoopOptions,
  LandLoopTicketOutcome,
  LandParkedReason,
} from './loop-land.js';
import { DEFAULT_MAX_SESSIONS_PER_TICKET } from './loop-claim.js';

type LandPushResults = Awaited<ReturnType<typeof pushLandedBranch>>;

/**
 * W21-33: release, unless another run has since claimed the ticket.
 *
 * The park path is where the live defect fired: a run whose ladder was
 * exhausted released a ticket a NEWER run had claimed fourteen seconds
 * earlier, and the newer run's close receipt was orphaned. With the guard in
 * place that release now throws, and a throw here would be no better — it
 * would crash the park and lose the park evidence that took two attempts to
 * produce. The right behaviour for a run that no longer holds the ticket is to
 * leave it alone and say so, which is what this does.
 */
function releaseUnlessTakenOver(options: LandLoopOptions, ticketId: string): void {
  try {
    releaseTicket(
      options.log,
      { ticketId, actorId: options.actorId },
      { runId: options.runId ?? null },
    );
  } catch (err) {
    if (!(err instanceof TicketError) || err.code !== 'STALE_RUN') throw err;
    commentTicket(
      options.log,
      {
        ticketId,
        actorId: options.actorId,
        body:
          `not released: another run has claimed this ticket since, so returning it ` +
          `to ready would take it away from the run currently working it (W21-33). ` +
          `${err.message}`,
      },
      { runId: options.runId ?? null },
    );
  }
}

export async function processTicket(
  options: LandLoopOptions,
  ticket: Ticket,
  baseRef: string,
): Promise<LandLoopTicketOutcome> {
  claimTicket(options.log, { ticketId: ticket.id, actorId: options.actorId }, { runId: options.runId ?? null });
  startTicket(options.log, { ticketId: ticket.id, actorId: options.actorId }, { runId: options.runId ?? null });
  let worktree: WorktreeHandle;
  try {
    worktree = await resolveWorktree(options, ticket, baseRef);
  } catch (err) {
    // W21-52: a stale worktree is a founder decision, not a crashed run.
    if (!(err instanceof StaleWorktreeError)) throw err;
    return parkBeforeAttempting(
      options,
      ticket,
      err.message,
      releaseUnlessTakenOver,
    ) as LandLoopTicketOutcome;
  }
  return landClaimedTicket(options, ticket, worktree, baseRef);
}

/**
 * W16-02: everything a berth does with a ticket ONCE IT HOLDS IT — the
 * attempts ladder, the close gate, the park, the push, every injected seam
 * (rungs, R0 consult, learning hook, verb mirror). Exported so `runBerths`'
 * injected `runTicket` and this loop's own `processTicket` are the SAME
 * engine rather than two drifting copies: the berth layer owns WHO claims
 * WHAT concurrently (lane-aware scheduling, per-berth identities); this
 * owns what happens to one claimed ticket. Callers have already claimed +
 * started the ticket under `options.actorId`.
 */
export async function landClaimedTicket(
  options: LandLoopOptions,
  ticket: Ticket,
  worktree: WorktreeHandle,
  baseRef: string,
): Promise<LandLoopTicketOutcome> {
  await fireVerbMirror(options, {
    kind: 'claim',
    ticketId: ticket.id,
    ticketTitle: ticket.title,
  });
  /**
   * W21-21: provisioning lives HERE, in the shared engine, because there are
   * THREE claim sites — loop-claim's processTicket (which nothing calls),
   * this file's processTicket, and berths' injected runTicket — each with its
   * own resolveWorktree. W21-12 put it at one of them and a live run proved it
   * never executed. Everything that lands a ticket funnels through this
   * function, so this is the only place it cannot be bypassed.
   */
  // W21-43: before a single model call. An unsatisfiable ticket used to burn
  // its whole ladder — two sessions, every turn — to discover a mismatch
  // readable from the ticket record alone.
  const unsatisfiable = unsatisfiableCriteria(ticket.acceptance ?? [], ticket.writeScope);
  if (unsatisfiable.length > 0) {
    return parkBeforeAttempting(
      options,
      ticket,
      unsatisfiableNotice(ticket.id, unsatisfiable),
      releaseUnlessTakenOver,
    ) as LandLoopTicketOutcome;
  }
  const provision = await provisionWorktree({
    worktreePath: worktree.path,
    log: options.log,
    actorId: options.actorId,
    ticketId: ticket.id,
    // W21-32: the option existed and this call site never passed it.
    ...(options.runId ? { runId: options.runId } : {}),
  });
  const provisionFailure = provisionFailureReason(provision);
  if (provisionFailure) {
    // W21-52: the third early-park path, now the same shape as the other two.
    return parkBeforeAttempting(
      options,
      ticket,
      provisionFailure,
      releaseUnlessTakenOver,
    ) as LandLoopTicketOutcome;
  }

  /**
   * W21-22: the agent is told what is already true of the worktree it is
   * standing in. Wrapped locally rather than widening HandoffBuilder and every
   * caller — the same shape this engine already uses to wrap `spawn` for
   * redaction.
   */
  const environment = provisionEnvironmentNote(provision);
  if (environment) {
    const inner = options.buildHandoff;
    options = {
      ...options,
      buildHandoff: async (t: Ticket, f?: AttemptFeedback) => ({
        ...(await inner(t, f)),
        environment,
      }),
    };
  }

  const role = options.role ?? ROLE_CODING_AGENT;
  const policy = resolveLandEscalationPolicy(options.policyScope ?? {}, role);
  const tokenHook = options.tokenHook ?? noopLandEscalationTokenHook;
  const ceiling = ceilingFor(
    policy,
    options.maxLadderAttempts ?? DEFAULT_MAX_SESSIONS_PER_TICKET,
  );

  const attempts: LandAttempt[] = [];
  // W13-29: the previous attempt's gaps — see `loop-land-session.ts`.
  // W16-03: seeded by the R0 consult when the playbook already holds a
  // verified answer — the maker meets it before any model spend.
  let feedback: AttemptFeedback | undefined = await consultRungZero(options, ticket);
  // W13-27: infra failures retry free — see `loop-land-infra.ts`.
  const freeRetry = createFreeRetryGate(options, ticket.id, ceiling);
  let current = requireTicket(options.log, ticket.id);
  let landed = false;
  let pushResults: LandPushResults | undefined;
  let parkedReason: LandParkedReason | undefined;
  let decideCard: ReturnType<typeof tokenBoundaryDecideCard> | undefined;

  // W21-46/55: a failed rung shifts the RUNG, never the attempt budget.
  const rungOffset = startAttemptFor(options.log, ticket.id, options.actorId, options.runId) - 1;
  for (
    let attempt = 1;
    attempt <= freeRetry.limit() && current.status === 'in_progress';
    attempt++
  ) {
    // W16-10 (FR-T6): one conflict-watch pass per attempt boundary — the
    // ticket is in_progress here, so its write lease is live and a human
    // edit inside it is a detectable collision. Ledger-and-swallow.
    if (options.conflictWatch) {
      await runAttemptOutcomeHook(options, () =>
        runConflictWatch({
          log: options.log,
          actorId: options.actorId,
          humanActorId: options.conflictWatch!.humanActorId,
          repoRoot: options.repoRoot,
          leases: activeLeases(listTickets(options.log)),
          ...(options.now ? { now: options.now } : {}),
        }).then(() => undefined),
      );
    }
    // W16-01: which rung this attempt runs at (the chapter also ledgers a
    // climb, evidence attached). Without a seam, options come back untouched.
    const rungStart = await beginRungAttempt(options, policy, ticket.id, attempts, rungOffset);
    // W21-44: the ledger marker this attempt's tool calls are counted from.
    const attemptStartSeq = latestSeq(options.log);
    const { session, closeGate, infraFailure } = await attemptOnce(
      rungStart.options,
      current,
      worktree,
      baseRef,
      feedback,
    );
    // W21-13: hand the provider's own words to the ledger, not just the
    // category. `session.output` is where runSessionAbsorbingProviderFailure
    // put them (`provider failure: …`).
    if (freeRetry.take(infraFailure, attempt, session.output)) continue;
    attempts.push({
      // W21-15. Not the loop index: that counter also advances for every free
      // infra retry, which is how the park evidence came to read
      // "attempt 5/2" — five attempts against a cap of two. The number a
      // person reads must be the count of attempts that were actually
      // JUDGED, so it can never exceed the ceiling it is printed against.
      attempt: attempts.length + 1,
      session,
      closeGate,
      ...(rungStart.sessionLabel ? { sessionLabel: rungStart.sessionLabel } : {}),
    });
    current = requireTicket(options.log, ticket.id);

    // W21-44: before feeding gaps forward, ask whether anything was attempted
    // at all. A second attempt after a session that changed nothing carries
    // the same information and the same instruction as the first.
    // Only while an attempt remains to be SAVED, and only with nowhere left to
    // CLIMB — see loop-land-attempted.ts, and the live run that found it.
    if (
      !closeGate?.ok &&
      attempt < freeRetry.limit() &&
      attemptedNothingEndsTheLadder({
        hasRungSessions: options.rungSessions !== undefined,
        policy,
        attempt,
      }) &&
      parkIfAttemptedNothing({ ...options, ticketId: ticket.id, sinceSeq: attemptStartSeq })
    ) {
      parkedReason = 'attempted_nothing';
      break;
    }

    // W13-29: feed the gaps forward, or stop if nothing changed.
    const step = nextFeedback(feedback, attempt, session, closeGate, {
      mode: policy.mode,
      limit: freeRetry.limit(),
    });
    if (step.kind === 'no_progress') {
      parkedReason = 'no_progress';
      break;
    }
    feedback = step.feedback;

    if (closeGate?.ok) {
      landed = true;
      await runAttemptOutcomeHook(options, () =>
        options.attemptOutcome?.onLanded({
          ticketId: ticket.id,
          commits: session.manifest?.commits ?? [],
          attempts,
        }),
      );
      await fireVerbMirror(options, {
        kind: 'close',
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        commits: session.manifest?.commits ?? [],
        receiptId: closeGate.receipt.id,
      });
      // Isolated per-remote; a failed remote is recorded, not fatal.
      pushResults = await pushLandedBranch(
        options.pushToRemotes,
        worktree.path,
        worktree.branch,
        options.pushRemotes,
      );
      recordFailedPushes(options.log, options.actorId, ticket.id, pushResults);
      break;
    }

    if (
      policy.mode === 'token-gated' &&
      attempt === attemptNumberForRung(policy.namedTier)
    ) {
      const token = await tokenHook.checkToken({
        ticketId: ticket.id,
        boundary: policy.namedTier,
      });
      if (!token) {
        parkedReason = 'awaiting_escalation_token';
        decideCard = tokenBoundaryDecideCard(ticket.id, ticket.title, policy);
        break;
      }
    }
  }

  const parked = !landed && current.status === 'in_progress';
  if (parked) {
    parkedReason ??=
      policy.mode === 'locked' ? 'locked_ceiling_reached' : 'ladder_exhausted';
    const parkBody = parkComment(
      parkedReason,
      ceiling,
      attempts,
      decideCard,
      freeRetry.absorbed(),
      // W21-19: read back out of the ledger — the pattern no single session
      // could see.
      repetitionEvidenceLine(
        repeatedZeroInformationCalls({ log: options.log, ticketId: ticket.id }),
      ),
    );
    commentTicket(options.log, {
      ticketId: ticket.id,
      actorId: options.actorId,
      body: parkBody,
    }, { runId: options.runId ?? null });
    await fireVerbMirror(options, {
      kind: 'evidence',
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      body: parkBody,
    });
    await runAttemptOutcomeHook(options, () =>
      options.attemptOutcome?.onParked({
        ticketId: ticket.id,
        reason: parkedReason ?? 'ladder_exhausted',
        attempts,
      }),
    );
    releaseUnlessTakenOver(options, ticket.id);
    current = requireTicket(options.log, ticket.id);
  }

  return {
    ticketId: ticket.id,
    mode: policy.mode,
    attempts,
    landed,
    pushResults,
    parked,
    parkedReason,
    finalStatus: current.status,
  };
}

