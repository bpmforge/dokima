/**
 * The Harbormaster claim loop (BLUEPRINT §3.6, FR-H1/H2, F1 split 1/3):
 * claim the lowest-id claimable ticket (WIP=1 per worker, enforced by
 * `@dokima/tickets`' `claimTicket`), give it a fresh git worktree, and
 * dispatch up to `maxSessionsPerTicket` fresh agent sessions through
 * W1-06's session runner. A session never mutates ticket state itself
 * (SC-02) — out-of-session gate execution and `close` are W3-01b's job;
 * this loop only re-reads the ticket after each session to notice whether
 * something else (a `close`, once b is wired in) already resolved it, and
 * stops retrying either way.
 *
 * When the session cap is exhausted with the ticket still `in_progress`,
 * the ticket is auto-blocked with evidence: no tickets verb produces a
 * stored `blocked` status or writes `evidence[]` (that's a reflow/UI
 * concern — BLUEPRINT §10 "blocked-with-evidence is a badge on a blocked
 * card, not a distinct status"), so evidence is attached via a real
 * `commentTicket` and the ticket is `releaseTicket`'d back to `ready` —
 * required by WIP=1 itself (an unreleased owned ticket would deadlock this
 * worker's next claim). An in-run skip set stops the loop from
 * immediately re-claiming the ticket it just gave up on.
 *
 * `canClaimNewTicket` is the real W2-07 `policyForLevel` output, checked
 * once per outer-loop iteration (a breaker never interrupts an in-flight
 * ticket — BudgetPolicy's own contract); the kill-file/pause `StopSwitch`
 * is checked at the same boundary (FR-H2: "checked between tickets").
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
import { policyForLevel, type BreakerLevel } from '@dokima/gateway';
import { runSession, type SessionResult, type SpawnSession } from '@dokima/loop';
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
import type { HandoffBuilder } from './loop-handoff.js';
import type { StopSwitch } from './loop-killswitch.js';

export const DEFAULT_MAX_SESSIONS_PER_TICKET = 2;

export interface ClaimLoopOptions {
  readonly log: EventLog;
  /** This worker/berth's identity (must already exist — events.actor_id is FK-enforced). */
  readonly actorId: string;
  /** The real repo root a ticket worktree branches from (FR-I1: `sw/<ticket-id>-<slug>`). */
  readonly repoRoot: string;
  readonly spawn: SpawnSession;
  readonly buildHandoff: HandoffBuilder;
  /** Commit-ish each ticket's worktree branches from. Defaults to HEAD (git's own default). */
  readonly baseRef?: CreateWorktreeOptions['baseRef'];
  /** Checked once per outer-loop iteration, before claiming the next ticket. Defaults to never stopping. */
  readonly stopSwitch?: StopSwitch;
  /** Checked once per outer-loop iteration; the resulting level is fed through the real W2-07 `policyForLevel`. Defaults to 'ok' (unlimited). */
  readonly breakerLevel?: () => BreakerLevel | Promise<BreakerLevel>;
  readonly maxSessionsPerTicket?: number;
}

export type ClaimLoopStopReason = 'idle' | 'stopped' | 'budget';

export interface TicketAttempt {
  readonly attempt: number;
  readonly session: SessionResult;
}

export interface ClaimLoopTicketOutcome {
  readonly ticketId: string;
  readonly attempts: readonly TicketAttempt[];
  readonly autoBlocked: boolean;
  readonly finalStatus: Ticket['status'];
}

export interface ClaimLoopResult {
  readonly processed: readonly ClaimLoopTicketOutcome[];
  readonly stopReason: ClaimLoopStopReason;
}

function requireTicket(log: EventLog, ticketId: string): Ticket {
  const ticket = getTicket(log, ticketId);
  if (!ticket) {
    throw new Error(`ticket ${ticketId} vanished mid-loop (event log is append-only)`);
  }
  return ticket;
}

/** Lowest-id claimable ticket, excluding this run's skip set (auto-blocked or otherwise already handled). */
function pickNextTicket(
  tickets: readonly Ticket[],
  skip: ReadonlySet<string>,
): Ticket | undefined {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets
    .filter((ticket) => !skip.has(ticket.id) && isClaimable(ticket, byId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

function evidenceComment(
  attempts: readonly TicketAttempt[],
  maxSessions: number,
): string {
  const lines = attempts.map(
    ({ attempt, session }) =>
      `attempt ${attempt}/${maxSessions}: exitCode=${session.exitCode} ` +
      `manifest=${session.manifest ? 'present' : 'absent'} ` +
      `scopeViolations=[${session.scopeViolations.join(', ')}]`,
  );
  return [
    `auto-blocked with evidence: session cap (${maxSessions}) reached without a close (FR-H2).`,
    ...lines,
  ].join('\n');
}

/**
 * A ticket that hit the session cap is auto-blocked and released back to `ready`
 * (see below) — its worktree/branch is deliberately left on disk as seed material
 * for the next attempt, mirroring this project's own kept-branch convention for
 * exhausted tickets. That means a reclaim (same run, once a future ticket adds
 * unlimited retries, or a fresh `runClaimLoop` process run after this one exits)
 * must reuse that worktree rather than call `createWorktree` again: `git worktree
 * add -b <branch>` fails outright when the branch/directory already exist.
 */
async function resolveWorktree(
  options: ClaimLoopOptions,
  ticket: Ticket,
): Promise<WorktreeHandle> {
  const worktreePath = path.join(options.repoRoot, '.dokima', 'worktrees', ticket.id);
  // `git worktree list --porcelain` reports symlink-resolved paths (matters on macOS,
  // where the default tmpdir sits behind /var -> /private/var); resolve ours the same
  // way before comparing. A missing directory can't be an existing worktree.
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
    baseRef: options.baseRef,
  });
}

async function processTicket(
  options: ClaimLoopOptions,
  ticket: Ticket,
  maxSessions: number,
): Promise<ClaimLoopTicketOutcome> {
  claimTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });
  startTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });

  const worktree = await resolveWorktree(options, ticket);

  const attempts: TicketAttempt[] = [];
  let current = requireTicket(options.log, ticket.id);

  for (
    let attempt = 1;
    attempt <= maxSessions && current.status === 'in_progress';
    attempt++
  ) {
    const handoff = options.buildHandoff(current);
    const session = await runSession({
      handoff,
      cwd: worktree.path,
      spawn: options.spawn,
    });
    attempts.push({ attempt, session });
    current = requireTicket(options.log, ticket.id);
  }

  const autoBlocked = current.status === 'in_progress' && attempts.length >= maxSessions;
  if (autoBlocked) {
    commentTicket(options.log, {
      ticketId: ticket.id,
      actorId: options.actorId,
      body: evidenceComment(attempts, maxSessions),
    });
    releaseTicket(options.log, { ticketId: ticket.id, actorId: options.actorId });
    current = requireTicket(options.log, ticket.id);
  }

  return { ticketId: ticket.id, attempts, autoBlocked, finalStatus: current.status };
}

/** Runs the claim loop until idle (nothing claimable), stopped (kill-file/pause), or budget-stopped (W2-07 hard_stop). */
export async function runClaimLoop(options: ClaimLoopOptions): Promise<ClaimLoopResult> {
  const maxSessions = options.maxSessionsPerTicket ?? DEFAULT_MAX_SESSIONS_PER_TICKET;
  const skip = new Set<string>();
  const processed: ClaimLoopTicketOutcome[] = [];

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

    processed.push(await processTicket(options, next, maxSessions));
    skip.add(next.id);
  }
}
