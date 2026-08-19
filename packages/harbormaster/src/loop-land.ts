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

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  branchNameFor,
  createWorktree,
  listWorktrees,
  type CreateWorktreeOptions,
  type WorktreeHandle,
} from '@dokima/git';
import { policyForLevel, ROLE_CODING_AGENT, type BreakerLevel } from '@dokima/gateway';
import type { SessionResult, SpawnSession } from '@dokima/loop';
import { attemptOnce } from './loop-land-session.js';
import { redactDeep } from '@dokima/shared';
import {
  claimTicket,
  commentTicket,
  getTicket,
  isClaimable,
  listTickets,
  releaseTicket,
  startTicket,
  type Ticket,
} from '@dokima/tickets';
import type { EventLog } from '@dokima/events';
import { DEFAULT_MAX_SESSIONS_PER_TICKET } from './loop-claim.js';
import type { HandoffBuilder } from './loop-handoff.js';
import type { StopSwitch } from './loop-killswitch.js';
import { runCloseGate, type CloseGateResult } from './loop-gates.js';
import {
  pushLandedBranch,
  recordFailedPushes,
  type PushToRemotesFn,
} from './land-push.js';
import {
  attemptNumberForRung,
  noopLandEscalationTokenHook,
  renderDecideCard,
  resolveLandEscalationPolicy,
  tokenBoundaryDecideCard,
  LAND_CONVERGENCE_CEILING,
  type LandEscalationMode,
  type LandEscalationPolicy,
  type LandEscalationTokenHook,
  type ScopedLandEscalationPolicy,
} from './loop-land-policy.js';

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
  LockedLandPolicy,
  PolicyRung,
  ScopedLandEscalationPolicy,
  TierKind,
  TokenGatedLandPolicy,
} from './loop-land-policy.js';
export {
  LADDER_LAND_POLICY,
  LAND_CONVERGENCE_CEILING,
  noopLandEscalationTokenHook,
  resolveLandEscalationPolicy,
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
  /** Commit-ish each ticket's worktree branches from AND the close gate's fork point. Defaults to 'main'. */
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
  /** Extra secret values (W11-16, FR-S2/SC-06, e.g. `collectSecretValues(vault, projectDir)`) redacted out of the rendered HANDOFF prompt before it reaches `spawn` (see `attemptOnce`). Omit for pattern-only redaction. */
  readonly secretValues?: readonly string[];
}

export type LandLoopStopReason = 'idle' | 'stopped' | 'budget';
export interface LandAttempt {
  readonly attempt: number;
  readonly session: SessionResult;
  /** `null` when the session returned no completion manifest — the close gate was never even attempted. */
  readonly closeGate: CloseGateResult | null;
}
export type LandParkedReason =
  'ladder_exhausted' | 'locked_ceiling_reached' | 'awaiting_escalation_token';
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

function requireTicket(log: EventLog, ticketId: string): Ticket {
  const ticket = getTicket(log, ticketId);
  if (!ticket) {
    throw new Error(`ticket ${ticketId} vanished mid-loop (event log is append-only)`);
  }
  return ticket;
}

/** Lowest-id claimable ticket, excluding this run's skip set (parked or otherwise already handled). */
function pickNextTicket(
  tickets: readonly Ticket[],
  skip: ReadonlySet<string>,
): Ticket | undefined {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets
    .filter((ticket) => !skip.has(ticket.id) && isClaimable(ticket, byId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/** Mirrors `loop-claim.ts`'s `resolveWorktree` (not exported there): reuses an on-disk worktree/branch from a prior park rather than re-`createWorktree`ing (which fails outright when the branch/directory already exist). */
async function resolveWorktree(
  options: LandLoopOptions,
  ticket: Ticket,
  baseRef: string,
): Promise<WorktreeHandle> {
  const worktreePath = path.join(options.repoRoot, '.dokima', 'worktrees', ticket.id);
  const resolvedWorktreePath = await fs.realpath(worktreePath).catch(() => undefined);
  const existing = await listWorktrees(options.repoRoot);
  const found = resolvedWorktreePath
    ? existing.find((entry) => entry.path === resolvedWorktreePath)
    : undefined;
  if (found) {
    return {
      repoRoot: options.repoRoot,
      path: worktreePath,
      branch: found.branch ?? branchNameFor(ticket.id, ticket.title),
      ticketId: ticket.id,
    };
  }
  return createWorktree({
    repoRoot: options.repoRoot,
    ticketId: ticket.id,
    slug: ticket.title,
    baseRef: baseRef as CreateWorktreeOptions['baseRef'],
  });
}

/** The attempt ceiling for `policy`'s mode (D-018: ladder's fixed cap, locked's FR-L7 convergence ceiling, token-gated's climbable R1-R3 range). */
function ceilingFor(policy: LandEscalationPolicy, maxLadderAttempts: number): number {
  switch (policy.mode) {
    case 'ladder':
      return maxLadderAttempts;
    case 'locked':
      return LAND_CONVERGENCE_CEILING[policy.tierKind];
    case 'token-gated':
      return 3; // R1-R3, this loop's full climbable range before R4's terminal park.
  }
}

function attemptSummaryLine(attempt: LandAttempt, ceiling: number): string {
  const gateSummary =
    attempt.closeGate === null
      ? 'no completion manifest returned'
      : attempt.closeGate.ok
        ? 'close gate passed'
        : `close gate refused: ${attempt.closeGate.reasons.join('; ')}`;
  return `attempt ${attempt.attempt}/${ceiling}: exitCode=${attempt.session.exitCode} ${gateSummary}`;
}

function parkComment(
  reason: LandParkedReason,
  ceiling: number,
  attempts: readonly LandAttempt[],
  decideCard: ReturnType<typeof tokenBoundaryDecideCard> | undefined,
): string {
  const header =
    reason === 'locked_ceiling_reached'
      ? `auto-blocked with evidence: locked-mode convergence ceiling (${ceiling}) reached without a close (D-018).`
      : reason === 'awaiting_escalation_token'
        ? 'auto-blocked with evidence: token-gated escalation boundary reached without an approval token (D-018, FR-N2).'
        : `auto-blocked with evidence: ladder attempt cap (${ceiling}) reached without a close (FR-H1/H2).`;
  const lines = [
    header,
    ...attempts.map((attempt) => attemptSummaryLine(attempt, ceiling)),
  ];
  if (decideCard) lines.push('', renderDecideCard(decideCard));
  return lines.join('\n');
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
  let current = requireTicket(options.log, ticket.id);
  let landed = false;
  let pushResults: LandPushResults | undefined;
  let parkedReason: LandParkedReason | undefined;
  let decideCard: ReturnType<typeof tokenBoundaryDecideCard> | undefined;

  for (
    let attempt = 1;
    attempt <= ceiling && current.status === 'in_progress';
    attempt++
  ) {
    const { session, closeGate } = await attemptOnce(options, current, worktree, baseRef);
    attempts.push({ attempt, session, closeGate });
    current = requireTicket(options.log, ticket.id);

    if (closeGate?.ok) {
      landed = true;
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
  const baseRef = options.baseRef ?? 'main';
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

    const next = pickNextTicket(listTickets(options.log), skip);
    if (!next) {
      return { processed, stopReason: 'idle' };
    }

    processed.push(await processTicket(options, next, baseRef));
    skip.add(next.id);
  }
}
