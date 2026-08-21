/**
 * The Harbormaster land loop (BLUEPRINT §3.6, FR-H1, D-018, F1 split 3/3):
 * claims tickets the same way W3-01a's `runClaimLoop` does, but instead of
 * a fixed session-cap auto-block, drives each ticket's retries through the
 * REAL out-of-session close gate (W3-01b's `runCloseGate`) and this
 * package's own D-018 escalation-policy modes (`loop-land-policy.ts`).
 *
 * "Land" = close -> checkpoint -> repeat: a passing `runCloseGate` call
 * mints the close receipt AND verifies the ticket branch's own commit(s)
 * (both "receipt + commit" — acceptance 1's checkpoint), then moves
 * `closeTicket` from `in_progress` to `in_review`. `in_review` does NOT
 * count toward WIP=1 (`@dokima/tickets`' `verbs.ts`: "close is what
 * frees the worker to claim the next ticket" — the exact BLUEPRINT §3.6
 * "claim … -> close -> checkpoint -> repeat" shape this ticket names), so
 * this loop advances to the next claimable ticket without releasing.
 *
 * `mergeLocal` (`@dokima/git`) is deliberately NOT wired in: landing on
 * `main` is D-018/BLUEPRINT §297/§388's NEVER-AUTO path (only the human,
 * or the reviewer identity under explicit policy, holds merge rights).
 * "Land" here stops at checkpointed `in_review` — the same maker/verifier
 * split `runCloseGate` (`close` never implies `accept`) already draws.
 *
 * "Park" = the ticket exhausts its policy-defined attempts without a
 * close: mirrors `loop-claim.ts`'s auto-block (`commentTicket` evidence +
 * `releaseTicket` back to `ready`, freeing WIP=1). `runCloseGate` already
 * comments per failed attempt; the park comment here is the aggregate
 * summary across every attempt, the same relationship `loop-claim.ts`'s
 * `evidenceComment` has to per-session output — plus a Decide card when a
 * token-gated boundary is what caused the park (see `loop-land-policy.ts`).
 */

import { resolveCurrentBranch } from '@dokima/git';
import { policyForLevel, ROLE_CODING_AGENT, type BreakerLevel } from '@dokima/gateway';
import { ceilingFor, createFreeRetryGate } from './loop-land-infra.js';
import { runAttemptOutcomeHook } from './loop-land-outcome.js';
import { parkComment } from './loop-land-report.js';
import { reclaimAbandoned } from './loop-land-reclaim.js';
import { nextFeedback } from './loop-land-session.js';
import type { SessionResult, SpawnSession } from '@dokima/loop';
import { attemptOnce } from './loop-land-session.js';
import {
  claimTicket,
  commentTicket,
  listTickets,
  releaseTicket,
  startTicket,
  type Ticket,
} from '@dokima/tickets';
import { type EventLog } from '@dokima/events';
import { DEFAULT_MAX_SESSIONS_PER_TICKET } from './loop-claim.js';

import type { AttemptFeedback, HandoffBuilder } from './loop-handoff.js';
import type { StopSwitch } from './loop-killswitch.js';
import type { CloseGateResult } from './loop-gates.js';
import {
  pushLandedBranch,
  recordFailedPushes,
  type PushToRemotesFn,
} from './land-push.js';
import {
  attemptNumberForRung,
  noopLandEscalationTokenHook,
  resolveLandEscalationPolicy,
  tokenBoundaryDecideCard,
  type LandEscalationMode,
  type LandEscalationTokenHook,
  type LandRungSessions,
  type ScopedLandEscalationPolicy,
} from './loop-land-policy.js';
import {
  beginRungAttempt,
  consultRungZero,
  type LandR0Consult,
} from './loop-land-rungs.js';
export type { LandR0Consult, LandR0ConsultResult } from './loop-land-rungs.js';
import { pickNextTicket, requireTicket, resolveWorktree } from './loop-land-board.js';

export type { LandPushRemoteResult, PushToRemotesFn } from './land-push.js';
type LandPushResults = Awaited<ReturnType<typeof pushLandedBranch>>;
export type {
  DecideCard,
  DecideCardOption,
  LandEscalationMode,
  LandEscalationPolicy,
  LandEscalationToken,
  LandEscalationTokenHook,
  LandEscalationTokenRequest,
  LandFailureReceipt,
  LandRungAdvance,
  LandRungSessions,
  LockedLandPolicy,
  PolicyRung,
  ScopedLandEscalationPolicy,
  TierKind,
  TokenGatedLandPolicy,
} from './loop-land-policy.js';
export {
  LADDER_LAND_POLICY,
  LAND_CONVERGENCE_CEILING,
  isHigherRung,
  noopLandEscalationTokenHook,
  resolveLandEscalationPolicy,
  rungForAttempt,
} from './loop-land-policy.js';

export interface LandLoopOptions {
  readonly log: EventLog;
  /** This worker/berth's identity (must already exist — events.actor_id is FK-enforced). */
  readonly actorId: string;
  readonly projectId: string;
  /** The real repo root a ticket worktree branches from (FR-I1: `sw/<ticket-id>-<slug>`). */
  readonly repoRoot: string;
  /** `content/validators` in production; a fixture directory in tests. */
  readonly contentDir: string;
  readonly signingKey: string;
  readonly spawn: SpawnSession;
  /** Dual-remote push primitive (FR-I2). Inject `@dokima/forge`'s `pushToRemotes` in production. */
  readonly pushToRemotes: PushToRemotesFn;
  readonly buildHandoff: HandoffBuilder;
  /**
   * Commit-ish each ticket's worktree branches from AND the close gate's fork
   * point. Defaults to the branch `repoRoot` is checked out on (W13-40) — a
   * detached HEAD refuses rather than guessing.
   */
  readonly baseRef?: string;
  /** Checked once per outer-loop iteration, before claiming the next ticket. Defaults to never stopping. */
  readonly stopSwitch?: StopSwitch;
  /** Checked once per outer-loop iteration; fed through the real W2-07 `policyForLevel`. Defaults to 'ok' (unlimited). */
  readonly breakerLevel?: () => BreakerLevel | Promise<BreakerLevel>;
  /** D-018 escalation policy, by role, across run/project/global scope. Defaults to `ladder` for every role. */
  readonly policyScope?: ScopedLandEscalationPolicy;
  /** The role whose D-018 policy governs this ticket, and the close gate's memory-eligibility role. Defaults to 'coding-agent'. */
  readonly role?: string;
  readonly tokenHook?: LandEscalationTokenHook;
  /** `ladder` mode's attempt cap. Defaults to `loop-claim.ts`'s own session cap (2). */
  readonly maxLadderAttempts?: number;
  readonly requiredValidators?: readonly string[];
  readonly verifyTimeoutMs?: number;
  readonly validatorTimeoutMs?: number;
  readonly memoryEligibleRoles?: readonly string[];
  /** `git remote` names to push a landed ticket branch to (FR-I2, dual-remote sync). Defaults to whatever remotes are actually configured on the repo (`git remote`, read fresh per ticket) — local-first: zero configured remotes is a normal, valid setup and pushes nothing. */
  readonly pushRemotes?: readonly string[];
  readonly now?: () => string;
  /** W14-05: injected learning hook — see `AttemptOutcomeHook`. */
  readonly attemptOutcome?: AttemptOutcomeHook;
  /**
   * W16-01: the rung->session seam. Present, each REAL attempt runs the
   * session the composing seam bound to its rung (`rungForAttempt`), and a
   * climb appends the canonical `escalation.rung_advanced` event carrying the
   * failed attempt's evidence (FR-G3). Absent, every attempt runs `spawn`,
   * byte-identical to the pre-W16-01 loop — the honest shape for the
   * external-agent runner and for a one-rung (pinned/local-only) ladder.
   */
  readonly rungSessions?: LandRungSessions;
  /** W16-03: the rung-ZERO consult ("have we solved this before?") — composed in apps/server; a hit leads the first handoff, the close gate still decides (C-2). */
  readonly r0Consult?: LandR0Consult;
  /** Extra secret values (W11-16, FR-S2/SC-06, e.g. `collectSecretValues(vault, projectDir)`) redacted out of the rendered HANDOFF prompt before it reaches `spawn` (see `attemptOnce`). Omit for pattern-only redaction. */
  readonly secretValues?: readonly string[];
}

export type LandLoopStopReason = 'idle' | 'stopped' | 'budget';
// W14-05 chapter (CODE_BOOK_PROTOCOL 400-line cap): the learning-loop seam
// lives in loop-land-outcome.ts; re-exported so callers keep one import.
import type { AttemptOutcomeHook } from './loop-land-outcome.js';
export { type AttemptOutcomeHook } from './loop-land-outcome.js';

export interface LandAttempt {
  readonly attempt: number;
  readonly session: SessionResult;
  /** `null` when the session returned no completion manifest — the close gate was never even attempted. */
  readonly closeGate: CloseGateResult | null;
  /** W16-01: the composing seam's label for what ran this attempt (a model name where the seam knows one). Absent without a `rungSessions` seam. Keys per-attempt calibration honestly when attempts ran on different rungs. */
  readonly sessionLabel?: string;
}
/** `no_progress` is W13-29 / BLUEPRINT §3.5: two attempts, identical gaps. */
export type LandParkedReason =
  | 'ladder_exhausted'
  | 'locked_ceiling_reached'
  | 'awaiting_escalation_token'
  | 'no_progress';
export interface LandLoopTicketOutcome {
  readonly ticketId: string;
  readonly mode: LandEscalationMode;
  readonly attempts: readonly LandAttempt[];
  /** True once a `runCloseGate` attempt succeeded (checkpoint reached — `in_review`). */
  readonly landed: boolean;
  /** Per-remote dual-remote push results after a successful land (FR-I2); `undefined` when never landed. A failed remote is isolated, not fatal — also recorded via `commentTicket` (`recordFailedPushes`). */
  readonly pushResults?: LandPushResults;
  readonly parked: boolean;
  readonly parkedReason?: LandParkedReason;
  readonly finalStatus: Ticket['status'];
}
export interface LandLoopResult {
  readonly processed: readonly LandLoopTicketOutcome[];
  readonly stopReason: LandLoopStopReason;
}

async function processTicket(
  options: LandLoopOptions,
  ticket: Ticket,
  baseRef: string,
): Promise<LandLoopTicketOutcome> {
  claimTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });
  startTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });

  const worktree = await resolveWorktree(options, ticket, baseRef);
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
    commentTicket(options.log, {
      ticketId: ticket.id,
      actorId: options.actorId,
      body: parkComment(parkedReason, ceiling, attempts, decideCard),
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

/** Runs the land loop until idle (nothing claimable), stopped (kill-file/pause), or budget-stopped (W2-07 hard_stop). */
export async function runLandLoop(options: LandLoopOptions): Promise<LandLoopResult> {
  /**
   * W13-40: the repo's OWN branch, not a guessed name. This was
   * `options.baseRef ?? 'main'`, and nothing on the server path supplies
   * `baseRef` — so on a repository whose trunk is called anything else, every
   * ticket refused with `fatal: invalid reference: main` and the board was
   * unworkable. `berths.ts` already resolves the same idea to HEAD; this makes
   * the loop agree with it instead of contradicting it.
   *
   * RESOLVED LAZILY, once, at the first ticket that needs it. Eagerly is the
   * obvious way to write this and it is wrong: a loop with nothing claimable
   * does no git work at all, and reading the branch up front made an idle run
   * in a non-repository fail before it could report that there was nothing to
   * do. Doing nothing must not require a repository.
   */
  let resolvedBaseRef: string | undefined = options.baseRef;
  const baseRefFor = async (): Promise<string> =>
    (resolvedBaseRef ??= await resolveCurrentBranch(options.repoRoot));
  const skip = new Set<string>();
  const processed: LandLoopTicketOutcome[] = [];

  for (;;) {
    if (options.stopSwitch && (await options.stopSwitch())) {
      return { processed, stopReason: 'stopped' };
    }

    const level = options.breakerLevel ? await options.breakerLevel() : 'ok';
    if (!policyForLevel(level).canClaimNewTicket) {
      return { processed, stopReason: 'budget' };
    }

    reclaimAbandoned(options);

    const next = pickNextTicket(listTickets(options.log), skip);
    if (!next) {
      return { processed, stopReason: 'idle' };
    }

    processed.push(await processTicket(options, next, await baseRefFor()));
    skip.add(next.id);
  }
}
