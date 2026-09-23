/**
 * The commit a ticket's work forked from (W23-53) — what a review is about.
 *
 * WHAT WENT WRONG LIVE. The review never told `collectReviewEvidence` where the
 * ticket started, so it diffed `HEAD^..HEAD`: on the 2026-09-23 Vault autorun,
 * V2-012 was two commits (the helper, then its spec) and the reviewer was shown
 * only the spec. W23-51's base-vs-head security baseline then compared against
 * the ticket's own first commit, which would have filed a finding introduced
 * there as "pre-existing".
 *
 * The fork point is the merge-base of the worktree's HEAD with the base the
 * land loop itself forks from (`resolveTicketBase`: the accepted dependency's
 * branch, else the run's branch). Null when that cannot be resolved — and the
 * caller must then treat the base as UNKNOWN, never as HEAD^.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EventLog } from '@dokima/events';
import { getTicket, listTickets, type Ticket } from '@dokima/tickets';
import { resolveTicketBase } from './loop-land-base.js';
import { currentSourceOf, type CurrentSource } from './verified-ticket-decision.js';

const execFileAsync = promisify(execFile);

export async function ticketForkPoint(input: {
  readonly repoRoot: string;
  readonly worktreePath: string;
  readonly ticket: Ticket;
  readonly tickets: readonly Ticket[];
}): Promise<string | null> {
  try {
    const base = await resolveTicketBase({
      repoRoot: input.repoRoot,
      ticket: input.ticket,
      tickets: [...input.tickets],
    });
    if (!base.ok) return null;
    const { stdout } = await execFileAsync('git', [
      '-C',
      input.worktreePath,
      'merge-base',
      'HEAD',
      base.ref,
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The ticket's source as it stands now, over the SAME range the review diffed
 * (fork point..HEAD). Freshness compares this digest with the reviewed one; a
 * different range would read every multi-commit ticket as stale, or — worse,
 * the other way round — let two different ranges compare equal by accident.
 */
export async function currentTicketSource(input: {
  readonly log: EventLog;
  readonly repoRoot: string;
  readonly ticketId: string;
  readonly worktreePath: string;
  readonly secretValues?: readonly string[];
}): Promise<CurrentSource> {
  const ticket = getTicket(input.log, input.ticketId);
  const fork = ticket
    ? await ticketForkPoint({
        repoRoot: input.repoRoot,
        worktreePath: input.worktreePath,
        ticket,
        tickets: listTickets(input.log),
      })
    : null;
  return currentSourceOf(
    input.ticketId,
    input.worktreePath,
    input.secretValues ?? [],
    fork,
  );
}
