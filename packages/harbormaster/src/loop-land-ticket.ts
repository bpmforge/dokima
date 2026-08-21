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
import type { WorktreeHandle } from '@dokima/git';
import {
  claimTicket,
  commentTicket,
  listTickets,
  releaseTicket,
  startTicket,
  type Ticket,
} from '@dokima/tickets';
import { ceilingFor, createFreeRetryGate } from './loop-land-infra.js';
import { runAttemptOutcomeHook } from './loop-land-outcome.js';
import { parkComment } from './loop-land-report.js';
import { attemptOnce, nextFeedback } from './loop-land-session.js';
import { pushLandedBranch, recordFailedPushes } from './land-push.js';
import {
  attemptNumberForRung,
  noopLandEscalationTokenHook,
  resolveLandEscalationPolicy,
  tokenBoundaryDecideCard,
} from './loop-land-policy.js';
import { beginRungAttempt, consultRungZero } from './loop-land-rungs.js';
import { fireVerbMirror } from './loop-land-verbs.js';
import { requireTicket, resolveWorktree } from './loop-land-board.js';
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

export async function processTicket(
  options: LandLoopOptions,
  ticket: Ticket,
  baseRef: string,
): Promise<LandLoopTicketOutcome> {
  claimTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });
  startTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });
  const worktree = await resolveWorktree(options, ticket, baseRef);
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
    const rungStart = await beginRungAttempt(options, policy, ticket.id, attempts);
    const { session, closeGate, infraFailure } = await attemptOnce(
      rungStart.options,
      current,
      worktree,
      baseRef,
      feedback,
    );
    if (freeRetry.take(infraFailure, attempt)) continue;
    attempts.push({
      attempt,
      session,
      closeGate,
      ...(rungStart.sessionLabel ? { sessionLabel: rungStart.sessionLabel } : {}),
    });
    current = requireTicket(options.log, ticket.id);

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
    const parkBody = parkComment(parkedReason, ceiling, attempts, decideCard);
    commentTicket(options.log, {
      ticketId: ticket.id,
      actorId: options.actorId,
      body: parkBody,
    });
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
    releaseTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });
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

