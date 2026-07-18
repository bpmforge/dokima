/**
 * Berths 1-N: parallel lanes, per-berth identities/worktrees (BLUEPRINT
 * §5, ARCHITECTURE.md §5, D-010, FR-H5, W3-04). `loop-claim.ts` and
 * `loop-land.ts` (W3-01a/W3-01c) are each a single berth's own
 * claim/land loop; this module is the concurrency layer that runs N of
 * them side by side. It does not reimplement session dispatch or the
 * close gate — `runTicket` is injected (mirrors `loop-claim.ts`'s
 * `spawn`/`loop-land.ts`'s `spawn` + close-gate wiring), so a production
 * caller composes this with `runSession`/`runCloseGate` itself; this
 * ticket owns only the scheduling invariant, not what a berth does with
 * a ticket once it holds one.
 *
 * Why not just run N independent `runLandLoop`s? Their own
 * `pickNextTicket` is private and lane-blind (BLUEPRINT §3.4's
 * cross-lane write-scope invariant is a plan-load-time schema check, not
 * a runtime scheduling one) — nothing stops two independent loops from
 * both claiming into the same lane. `pickNextBerthTicket`
 * (berths-scheduler.ts) is the lane-aware picker this module needs
 * instead; see that module's doc for why picking it and claiming it
 * synchronously, with no `await` between, is race-free across
 * concurrently-running berths in one process.
 *
 * `pauseRun`/`stopRun` (breakpoints-runs.ts) are deliberately NOT called
 * here: this module reports `stopReason: 'breakpoint'` per berth and
 * leaves recording that against the `RunRecord` to the caller, the same
 * "drop-in unit" posture `watchdog-session.ts`/`limit-pause.ts` already
 * document for their own modules — attributing a pause to a specific
 * actor (as `pauseRun` requires) is a wiring decision outside this
 * ticket's write_scope.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  branchNameFor,
  createWorktree,
  listWorktrees,
  type CreateWorktreeOptions,
  type WorktreeHandle,
} from '@shipwright/git';
import { policyForLevel, type BreakerLevel } from '@shipwright/gateway';
import {
  claimTicket,
  commentTicket,
  getTicket,
  isClaimable,
  listTickets,
  releaseTicket,
  startTicket,
  type Ticket,
} from '@shipwright/tickets';
import type { EventLog } from '@shipwright/events';
import { shouldPauseAtBreakpoint, waveOf } from './breakpoints.js';
import type { BreakpointMode } from './breakpoints-types.js';
import { ensureBerthIdentities } from './berths-identity.js';
import { pickNextBerthTicket } from './berths-scheduler.js';
import type { StopSwitch } from './loop-killswitch.js';

export {
  resolveAutorunBreakpoint,
  resolveBerthCount,
  BERTHS_SETTINGS_KEY,
  DEFAULT_BERTHS,
} from './berths-dial.js';
export type {
  AutorunToggle,
  ResolveBerthCountOptions,
  ResolvedRunConcurrency,
} from './berths-dial.js';
export { busyLanes, pickNextBerthTicket } from './berths-scheduler.js';
export { berthIdentityId, ensureBerthIdentities } from './berths-identity.js';
export type { EnsureBerthIdentitiesOptions } from './berths-identity.js';

/** Deterministic per-run berth id, 1-based (matches `ensureBerthIdentities`' identity ordering). */
export function berthIdOf(berthIndex: number): string {
  return `berth-${berthIndex}`;
}

export interface BerthTicketRunnerInput {
  readonly ticket: Ticket;
  readonly worktree: WorktreeHandle;
  readonly berthId: string;
  /** This berth's machine identity (FR-H5) — every verb/event the runner causes must be attributed to this actor. */
  readonly actorId: string;
}

/**
 * Does the actual work of one ticket (sessions, the close gate, whatever
 * a caller composes) and drives the ticket's own lifecycle verbs
 * (`closeTicket`/`releaseTicket`, etc). `runBerths` has already called
 * `claimTicket`/`startTicket` before invoking this — the runner picks up
 * from `in_progress`. If it returns with the ticket still `in_progress`,
 * `runBerths` auto-blocks it (mirrors `loop-claim.ts`'s session-cap
 * auto-block) so a stuck runner can never wedge a lane open forever.
 */
export type BerthTicketRunner = (input: BerthTicketRunnerInput) => Promise<void>;

export interface RunBerthsOptions {
  readonly log: EventLog;
  readonly runId: string;
  readonly projectId: string;
  /** The real repo root every berth's worktrees branch from (FR-I1). */
  readonly repoRoot: string;
  /** Resolved dial value (berths-dial.ts's `resolveBerthCount`) — this module doesn't re-resolve settings itself. */
  readonly berths: number;
  readonly runTicket: BerthTicketRunner;
  readonly baseRef?: CreateWorktreeOptions['baseRef'];
  /** Defaults to `'never'` (D-010: the multi-berth headline case is autorun). */
  readonly breakpoint?: BreakpointMode;
  /** Checked once per berth per outer-loop iteration; shared across every berth so a kill/pause takes effect for all of them at their next ticket boundary. */
  readonly stopSwitch?: StopSwitch;
  /** Shared across every berth (pass the SAME callback, e.g. one backed by one `CostLedger`/`BudgetBreakerTracker` for the run) so one berth's spend halts every berth at its next ticket boundary — `@shipwright/gateway`'s `CostLedger` already aggregates by (project, run) without filtering by berth (FR-H5). Defaults to `'ok'` (unlimited). */
  readonly breakerLevel?: () => BreakerLevel | Promise<BreakerLevel>;
  readonly identityNamePrefix?: string;
  readonly now?: () => string;
}

export type BerthStopReason = 'idle' | 'stopped' | 'budget' | 'breakpoint';

export interface BerthTicketOutcome {
  readonly ticketId: string;
  /** True once the runner left the ticket `in_review` (checkpoint reached). */
  readonly landed: boolean;
  /** True once the runner (or this module's own auto-block) released the ticket back to `ready` without landing it. */
  readonly parked: boolean;
  readonly finalStatus: Ticket['status'];
}

export interface BerthOutcome {
  readonly berthId: string;
  readonly actorId: string;
  readonly processed: readonly BerthTicketOutcome[];
  readonly stopReason: BerthStopReason;
}

export interface RunBerthsResult {
  readonly berths: readonly BerthOutcome[];
}

function requireTicket(log: EventLog, ticketId: string): Ticket {
  const ticket = getTicket(log, ticketId);
  if (!ticket) {
    throw new Error(`ticket ${ticketId} vanished mid-loop (event log is append-only)`);
  }
  return ticket;
}

/**
 * Mirrors `loop-claim.ts`/`loop-land.ts`'s own (private, duplicated
 * between those two modules already) `resolveWorktree`: ticket-id-keyed
 * path, so re-running after a park reuses the on-disk worktree/branch
 * instead of `git worktree add` failing on an already-existing
 * dir/branch. Keyed by ticket id rather than berth id — since at most one
 * berth ever holds a given ticket at a time (lane exclusivity), this
 * already gives every concurrently-active ticket, regardless of which
 * berth claimed it, its own isolated worktree (FR-H5 "own git worktree").
 */
async function resolveBerthWorktree(
  repoRoot: string,
  ticket: Ticket,
  baseRef: CreateWorktreeOptions['baseRef'],
): Promise<WorktreeHandle> {
  const worktreePath = path.join(repoRoot, '.shipwright', 'worktrees', ticket.id);
  const resolvedWorktreePath = await fs.realpath(worktreePath).catch(() => undefined);
  const existing = await listWorktrees(repoRoot);
  const found = resolvedWorktreePath
    ? existing.find((entry) => entry.path === resolvedWorktreePath)
    : undefined;
  if (found) {
    return {
      repoRoot,
      path: worktreePath,
      branch: found.branch ?? branchNameFor(ticket.id, ticket.title),
      ticketId: ticket.id,
    };
  }
  return createWorktree({ repoRoot, ticketId: ticket.id, slug: ticket.title, baseRef });
}

interface SharedBerthState {
  paused: boolean;
}

/** True once any landed ticket in this run has crossed `breakpoint`'s pause condition (breakpoints.ts's `shouldPauseAtBreakpoint`, evaluated over the tickets still claimable right now). */
function checkBreakpointAfterLanding(
  log: EventLog,
  breakpoint: BreakpointMode,
  landedTicketId: string,
  skip: ReadonlySet<string>,
): boolean {
  const remaining = listTickets(log).filter((ticket) => !skip.has(ticket.id));
  const byId = new Map(remaining.map((ticket) => [ticket.id, ticket]));
  const remainingClaimableWaves = remaining
    .filter((ticket) => isClaimable(ticket, byId))
    .map((ticket) => waveOf(ticket.id));
  return shouldPauseAtBreakpoint({
    breakpoint,
    justClosedWave: waveOf(landedTicketId),
    remainingClaimableWaves,
  });
}

async function runOneBerth(
  options: RunBerthsOptions,
  berthId: string,
  actorId: string,
  baseRef: CreateWorktreeOptions['baseRef'],
  breakpoint: BreakpointMode,
  shared: SharedBerthState,
): Promise<BerthOutcome> {
  const skip = new Set<string>();
  const processed: BerthTicketOutcome[] = [];

  for (;;) {
    if (options.stopSwitch && (await options.stopSwitch())) {
      return { berthId, actorId, processed, stopReason: 'stopped' };
    }
    if (shared.paused) {
      return { berthId, actorId, processed, stopReason: 'breakpoint' };
    }
    const level = options.breakerLevel ? await options.breakerLevel() : 'ok';
    if (!policyForLevel(level).canClaimNewTicket) {
      return { berthId, actorId, processed, stopReason: 'budget' };
    }

    // Pick + claim, synchronously and back-to-back (berths-scheduler.ts's
    // module doc explains why this is race-free across concurrent berths).
    const next = pickNextBerthTicket(listTickets(options.log), skip);
    if (!next) {
      return { berthId, actorId, processed, stopReason: 'idle' };
    }
    claimTicket(options.log, { ticketId: next.id, actorId });
    startTicket(options.log, { ticketId: next.id, actorId });

    const worktree = await resolveBerthWorktree(options.repoRoot, next, baseRef);
    await options.runTicket({
      ticket: requireTicket(options.log, next.id),
      worktree,
      berthId,
      actorId,
    });

    let current = requireTicket(options.log, next.id);
    if (current.status === 'in_progress') {
      commentTicket(options.log, {
        ticketId: next.id,
        actorId,
        body:
          'auto-blocked with evidence: berth runner returned without closing or ' +
          'releasing the ticket (FR-H5).',
      });
      releaseTicket(options.log, { ticketId: next.id, actorId });
      current = requireTicket(options.log, next.id);
    }

    const landed = current.status === 'in_review';
    const parked = current.status === 'ready';
    processed.push({ ticketId: next.id, landed, parked, finalStatus: current.status });
    skip.add(next.id);

    if (landed && checkBreakpointAfterLanding(options.log, breakpoint, next.id, skip)) {
      shared.paused = true;
    }
  }
}

/** Runs `options.berths` concurrent berths to completion (each stops idle/stopped/budget/breakpoint independently, but a shared breaker or breakpoint pause halts every berth at its own next ticket boundary). */
export async function runBerths(options: RunBerthsOptions): Promise<RunBerthsResult> {
  const count = Math.max(1, Math.trunc(options.berths));
  const identities = ensureBerthIdentities(options.log, options.runId, count, {
    now: options.now,
    namePrefix: options.identityNamePrefix,
  });
  const breakpoint = options.breakpoint ?? 'never';
  const baseRef = options.baseRef ?? 'HEAD';
  const shared: SharedBerthState = { paused: false };

  const outcomes = await Promise.all(
    identities.map((identity, index) =>
      runOneBerth(
        options,
        berthIdOf(index + 1),
        identity.id,
        baseRef,
        breakpoint,
        shared,
      ),
    ),
  );
  return { berths: outcomes };
}
