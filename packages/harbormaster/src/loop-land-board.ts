/**
 * loop-land-board.ts — picking and preparing the next ticket (W16-01 split).
 *
 * Chapter of `loop-land.ts`, split under the 400-line CODE_BOOK_PROTOCOL cap
 * when the rung->session seam pushed that file past it. The seam is real:
 * these three helpers answer "which ticket, and in which worktree" — they
 * read board state and disk, and never run an attempt.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  branchNameFor,
  createWorktree,
  destroyWorktree,
  git,
  listWorktrees,
  type CreateWorktreeOptions,
  type WorktreeHandle,
} from '@dokima/git';
import { getTicket, isClaimable, type Ticket } from '@dokima/tickets';
import type { EventLog } from '@dokima/events';
import type { LandLoopOptions } from './loop-land.js';

export function requireTicket(log: EventLog, ticketId: string): Ticket {
  const ticket = getTicket(log, ticketId);
  if (!ticket) {
    throw new Error(`ticket ${ticketId} vanished mid-loop (event log is append-only)`);
  }
  return ticket;
}

/** Lowest-id claimable ticket, excluding this run's skip set (parked or otherwise already handled). */
export function pickNextTicket(
  tickets: readonly Ticket[],
  skip: ReadonlySet<string>,
): Ticket | undefined {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets
    .filter((ticket) => !skip.has(ticket.id) && isClaimable(ticket, byId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/** Mirrors `loop-claim.ts`'s `resolveWorktree` (not exported there): reuses an on-disk worktree/branch from a prior park rather than re-`createWorktree`ing (which fails outright when the branch/directory already exist). */
export async function resolveWorktree(
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
    /**
     * W21-37: a worktree created on the WRONG base is worse than no worktree.
     * Run 17 left PLAN-vault-002 a worktree forked from a `main` that held one
     * file, and reusing it would defeat the base fix silently — the failure
     * would look identical and the cause would have moved.
     *
     * Recreating is safe only while the agent has committed nothing: a
     * worktree carrying real work must never be discarded to fix a base, so
     * that case refuses and reaches a person instead.
     */
    if (!(await containsBase(options.repoRoot, worktreePath, baseRef))) {
      if (await hasAgentCommits(options.repoRoot, worktreePath, baseRef)) {
        throw new Error(
          `worktree for ${ticket.id} was created from a different base and ` +
            `already holds commits, so it cannot be recreated without losing ` +
            `them. Land or discard that branch, then re-run (W21-37).`,
        );
      }
      await destroyWorktree({
        repoRoot: options.repoRoot,
        path: worktreePath,
        branch: found.branch ?? branchNameFor(ticket.id, ticket.title),
        ticketId: ticket.id,
      });
    } else {
      return {
        repoRoot: options.repoRoot,
        path: worktreePath,
        branch: found.branch ?? branchNameFor(ticket.id, ticket.title),
        ticketId: ticket.id,
      };
    }
  }
  return createWorktree({
    repoRoot: options.repoRoot,
    ticketId: ticket.id,
    slug: ticket.title,
    baseRef: baseRef as CreateWorktreeOptions['baseRef'],
  });
}

/** Whether an existing worktree's HEAD already contains everything `baseRef` carries. */
async function containsBase(
  repoRoot: string,
  worktreePath: string,
  baseRef: string,
): Promise<boolean> {
  try {
    const base = (await git(repoRoot, ['rev-parse', `${baseRef}^{commit}`])).stdout.trim();
    await git(worktreePath, ['merge-base', '--is-ancestor', base, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** Whether the worktree's branch has commits of its own beyond where it forked. */
async function hasAgentCommits(
  repoRoot: string,
  worktreePath: string,
  baseRef: string,
): Promise<boolean> {
  try {
    const forkPoint = (await git(repoRoot, ['rev-parse', `${baseRef}^{commit}`])).stdout.trim();
    const count = (
      await git(worktreePath, ['rev-list', '--count', `${forkPoint}..HEAD`])
    ).stdout.trim();
    return Number(count) > 0;
  } catch {
    // Cannot tell — assume there IS work. Refusing costs a person a minute;
    // guessing wrong destroys a session's output.
    return true;
  }
}
