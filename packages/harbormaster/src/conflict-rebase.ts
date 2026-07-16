/**
 * Human-wins rebase + park orchestrator (BLUEPRINT §7.3 steps 2-3, FR-T6,
 * UC-04). `runConflictWatch` (`conflict-watcher.ts`) only *detects*; an
 * uncommitted edit sitting in the human's working tree can't be rebased
 * onto (a worktree rebase pulls in commits, never working-tree state), so
 * this module first commits the human's edit onto the checkout's current
 * branch — attribution is the event log's own `actorId` field (the
 * mechanism every verb in this codebase already uses), not git authorship
 * — then rebases the ticket's worktree onto that commit.
 *
 * A clean rebase re-grounds the micro-loop: mints `conflict.rebased`;
 * wiring a running loop to re-run its CRITERION/EVIDENCE steps on that
 * signal is `packages/loop`'s job, out of this write_scope — same
 * "drop-in unit a future ticket composes in" posture `limit-pause.ts`
 * documents for its own module. A material conflict aborts the rebase and
 * parks the ticket exactly the way `loop-land.ts`'s ladder-exhausted park
 * already works: evidence `commentTicket` (embedding a take-mine /
 * take-agent's / merge-view Decide card) + `releaseTicket` back to `ready`
 * — the human's commit stands either way (UC-04 postcondition: "no lost
 * human work, ever").
 */

import { git, type WorktreeHandle } from '@shipwright/git';
import { commentTicket, releaseTicket, type Ticket } from '@shipwright/tickets';
import type { EventLog } from '@shipwright/events';
import { renderDecideCard, type DecideCard } from './loop-land-policy.js';
import {
  mintConflictParked,
  mintConflictRebased,
  type MintConflictEventOptions,
} from './conflict-events.js';

/** The Decide card raised when a material rebase conflict parks the ticket (BLUEPRINT §7.3 step 3, US-206 AC-3). */
export function humanEditConflictDecideCard(
  ticketId: string,
  ticketTitle: string,
  conflictedPaths: readonly string[],
): DecideCard {
  return {
    question: `A human edit conflicts with agent work on ${ticketId} — how should it resolve?`,
    context:
      `${ticketId} (${ticketTitle}) could not rebase cleanly onto a human edit to ` +
      `${conflictedPaths.join(', ')} (FR-T6). The human's edit is preserved either way.`,
    options: [
      {
        label: 'take mine',
        costSummary: "keep the human's edit; discard the agent's conflicting work",
      },
      {
        label: "take agent's",
        costSummary: "keep the agent's work; the human's edit must be reapplied manually",
      },
      {
        label: 'merge view',
        costSummary: 'open a manual merge view — no side is discarded automatically',
      },
    ],
    recommendedDefault: 'take mine',
  };
}

export interface CommitHumanEditOptions {
  readonly repoRoot: string;
  readonly paths: readonly string[];
  readonly message: string;
  /** The branch a worktree rebase will later pull this commit in from. Refuses if `repoRoot` isn't currently on it — same guard `@shipwright/git`'s `mergeLocal` uses, because a mismatch here would silently commit the human's edit somewhere a rebase never sees, reporting a false "human wins". */
  readonly expectedBranch: string;
}

/** Commits the human's working-tree edit onto the checkout's current branch — the commit a worktree rebase later pulls in. */
export async function commitHumanEdit(options: CommitHumanEditOptions): Promise<string> {
  const { stdout } = await git(options.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = stdout.trim();
  if (currentBranch !== options.expectedBranch) {
    throw new Error(
      `commitHumanEdit: repoRoot is checked out on '${currentBranch}', expected ` +
        `'${options.expectedBranch}' (the ticket's baseRef) — committing here would strand ` +
        `the human's edit somewhere the worktree rebase never sees it`,
    );
  }
  await git(options.repoRoot, ['add', '--', ...options.paths]);
  await git(options.repoRoot, ['commit', '-m', options.message]);
  const { stdout: headSha } = await git(options.repoRoot, ['rev-parse', 'HEAD']);
  return headSha.trim();
}

/** Distinguishes a real merge conflict from any other rebase failure (dirty tree, bad ref) — only the former is this policy's call to make. */
async function hasUnmergedPaths(worktreePath: string): Promise<boolean> {
  const { stdout } = await git(worktreePath, ['diff', '--name-only', '--diff-filter=U']);
  return stdout.trim().length > 0;
}

export type RebaseOutcome =
  | { readonly kind: 'rebased'; readonly ontoSha: string }
  | { readonly kind: 'parked'; readonly decideCard: DecideCard };

export interface ResolveHumanEditConflictOptions {
  /** The ticket's owning worker identity — the same actorId `claimTicket`/`startTicket` used; performs the release on a material conflict (`releaseTicket` requires actorId === ticket.ownerId). */
  readonly actorId: string;
  /** Whoever edited the checkout — the commit's attribution event (FR-L4). */
  readonly humanActorId: string;
  readonly log: EventLog;
  readonly ticket: Ticket;
  readonly worktree: WorktreeHandle;
  readonly baseRef: string;
  /** The human's checkout — usually `worktree.repoRoot`. */
  readonly repoRoot: string;
  readonly conflictedPaths: readonly string[];
  readonly commitMessage?: string;
  readonly now?: () => string;
}

/**
 * Runs BLUEPRINT §7.3's resolution sequence for one ticket's conflicting
 * edits, assuming `conflict.detected` has already been minted
 * (`conflict-watcher.ts`'s `runConflictWatch`): commit + attribute the
 * human's edit -> attempt the worktree rebase -> re-ground (clean) or park
 * with a Decide card (material conflict). Rethrows anything that isn't a
 * genuine merge conflict (a dirty worktree, a bad ref) — this policy only
 * ever resolves the conflict case, never swallows an unrelated failure.
 */
export async function resolveHumanEditConflict(
  options: ResolveHumanEditConflictOptions,
): Promise<RebaseOutcome> {
  const now = options.now ?? (() => new Date().toISOString());
  const opts: MintConflictEventOptions = { now };
  const paths = [...new Set(options.conflictedPaths)];

  const commitSha = await commitHumanEdit({
    repoRoot: options.repoRoot,
    paths,
    message:
      options.commitMessage ??
      `human edit: ${paths.join(', ')} (leased by ${options.ticket.id}, FR-T6)`,
    expectedBranch: options.baseRef,
  });

  try {
    await git(options.worktree.path, ['rebase', options.baseRef]);
  } catch (err) {
    if (!(await hasUnmergedPaths(options.worktree.path))) {
      await git(options.worktree.path, ['rebase', '--abort']).catch(() => undefined);
      throw err;
    }
    await git(options.worktree.path, ['rebase', '--abort']);
    const decideCard = humanEditConflictDecideCard(
      options.ticket.id,
      options.ticket.title,
      paths,
    );
    mintConflictParked(
      options.log,
      options.actorId,
      options.ticket.id,
      { conflictedPaths: paths },
      opts,
    );
    commentTicket(
      options.log,
      {
        ticketId: options.ticket.id,
        actorId: options.actorId,
        body: [
          `blocked: human-edit-conflict — material rebase conflict onto ${options.baseRef} ` +
            `(human commit ${commitSha}, FR-T6).`,
          renderDecideCard(decideCard),
        ].join('\n\n'),
      },
      { now },
    );
    releaseTicket(
      options.log,
      { ticketId: options.ticket.id, actorId: options.actorId },
      { now },
    );
    return { kind: 'parked', decideCard };
  }

  const { stdout: ontoSha } = await git(options.worktree.path, ['rev-parse', 'HEAD']);
  mintConflictRebased(
    options.log,
    options.actorId,
    options.ticket.id,
    { baseRef: options.baseRef, ontoSha: ontoSha.trim() },
    opts,
  );
  return { kind: 'rebased', ontoSha: ontoSha.trim() };
}
