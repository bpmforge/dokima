/**
 * loop-land-base.ts — a ticket starts from its dependencies (W21-37).
 *
 * Run 17 found this and it is the structural blocker for any multi-ticket
 * project. PLAN-vault-002 (Argon2id + AES-256-GCM) parked twice in seventy
 * seconds, and the ledger says why in one line:
 *
 *   #1336 worktree.provisioned {"ran":false,"why":"no package.json — nothing to install"}
 *
 * The agent's own checkpoint says the rest: `{"completed":[],"next":"Create
 * package.json with test scripts"}`. It was being asked to redo
 * PLAN-vault-001's work — which is outside its write_scope, so it could never
 * have succeeded.
 *
 * The cause: `main` in that repo holds one file. PLAN-vault-001's landed work
 * is on `sw/PLAN-vault-001-…` and was never merged, and `runLandLoop`
 * resolved a single base ref ONCE and branched every ticket from it. So
 * `depends_on` ordered the work and never fed it. A dependency-ordered DAG
 * whose tickets cannot see each other's output cannot build a product.
 *
 * THE FIX IS NOT AUTO-MERGE, and that is the whole design of this module.
 * BLUEPRINT and ARCHITECTURE.md both say merges to main are NEVER-AUTO — they
 * belong in the morning queue — and `land-push.ts` says outright that the
 * merge to main is one this package "deliberately never performs". Making the
 * loop merge to main so a demo works would break a documented founder
 * guarantee. Instead a ticket branches from a base that already contains its
 * dependencies, and `main` stays exactly where the founder left it.
 *
 * Three constraints, each ruling out a simpler version:
 *
 *   - ACCEPTED, not merely closed. A dependency in `in_review` has not passed
 *     the human check. Building on it would make acceptance retroactive and
 *     launder C-4 — a ticket would silently inherit unreviewed work.
 *   - A MISSING DEPENDENCY BRANCH REFUSES. Falling back to `main` is exactly
 *     what produced the live failure: the base was wrong and the only thing
 *     that said so was an informational provisioning line.
 *   - SEVERAL DEPENDENCIES COMPOSE, AND A CONFLICT IS A DECISION. Later
 *     tickets depend on more than one. Merging them into a throwaway
 *     integration ref is the honest version, and two dependencies that
 *     genuinely conflict is something a person must resolve, not something the
 *     loop should guess at.
 */
import { git, resolveCurrentBranch, branchNameFor } from '@dokima/git';
import type { Ticket } from '@dokima/tickets';

/** Where a composed multi-dependency base is written. Throwaway and per-ticket. */
export function integrationRefFor(ticketId: string): string {
  return `refs/dokima/base/${ticketId}`;
}

export type TicketBase =
  | { readonly ok: true; readonly ref: string; readonly from: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export interface TicketBaseInput {
  readonly repoRoot: string;
  readonly ticket: Ticket;
  /** Every ticket on the board, for resolving `dependsOn` to status and branch. */
  readonly tickets: readonly Ticket[];
  /** The run's branch — the base when a ticket has no accepted dependencies. */
  readonly fallbackRef?: string;
}

/** `git(cwd, args)` throws on a non-zero exit, so "did this work" is a catch. */
async function tryGit(repoRoot: string, args: string[]): Promise<string | null> {
  try {
    return (await git(repoRoot, args)).stdout.trim();
  } catch {
    return null;
  }
}

async function branchExists(repoRoot: string, ref: string): Promise<boolean> {
  return (await tryGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])) !== null;
}

/**
 * The commit-ish this ticket's worktree should fork from.
 *
 * No dependencies, or none accepted yet, means the run's own branch — byte
 * identical to the pre-W21-37 behaviour, so a single-ticket project and
 * Dokima's own board are unaffected.
 */
export async function resolveTicketBase(input: TicketBaseInput): Promise<TicketBase> {
  const fallback =
    input.fallbackRef ?? (await resolveCurrentBranch(input.repoRoot));
  const dependencies = input.ticket.dependsOn ?? [];
  if (dependencies.length === 0) return { ok: true, ref: fallback, from: [] };

  const branches: string[] = [];
  for (const id of dependencies) {
    const dependency = input.tickets.find((t) => t.id === id);
    // A dependency that is not accepted contributes nothing. It is not an
    // error: `pickNextTicket` will not offer this ticket until its blockers
    // are done, so this is the ordinary shape while a board is in flight.
    if (!dependency || dependency.status !== 'done') continue;
    const branch = branchNameFor(dependency.id, dependency.title);
    if (!(await branchExists(input.repoRoot, branch))) {
      return {
        ok: false,
        reason:
          `cannot start ${input.ticket.id}: its accepted dependency ${dependency.id} ` +
          `has no branch ${branch} in this repository, so the work it landed is ` +
          `not reachable. Starting from ${fallback} instead would hand this ` +
          `ticket a tree without its dependency's files, which is how a ticket ` +
          `ends up being asked to redo work outside its own write_scope (W21-37).`,
      };
    }
    branches.push(branch);
  }

  if (branches.length === 0) return { ok: true, ref: fallback, from: [] };
  if (branches.length === 1) return { ok: true, ref: branches[0]!, from: branches };

  const integration = integrationRefFor(input.ticket.id);
  const composed = await composeBase(input.repoRoot, integration, fallback, branches);
  return composed
    ? { ok: true, ref: integration, from: branches }
    : {
        ok: false,
        reason:
          `cannot start ${input.ticket.id}: its accepted dependencies ` +
          `(${branches.join(', ')}) do not merge cleanly, so there is no single ` +
          `tree to start from. Two landed tickets that conflict is a decision ` +
          `for a person — resolve them and re-run (W21-37).`,
      };
}

/**
 * Builds the throwaway integration ref by merging each dependency branch onto
 * the fallback, in a temporary worktree so the caller's checkout is never
 * touched. Returns false on the first conflict — a partial merge is never left
 * behind for something else to find.
 */
async function composeBase(
  repoRoot: string,
  integration: string,
  fallback: string,
  branches: readonly string[],
): Promise<boolean> {
  const start = await tryGit(repoRoot, ['rev-parse', `${fallback}^{commit}`]);
  if (start === null) return false;
  const abandon = async (): Promise<false> => {
    await tryGit(repoRoot, ['update-ref', '-d', integration]);
    return false;
  };
  await tryGit(repoRoot, ['update-ref', integration, start]);
  for (const branch of branches) {
    // `merge-tree --write-tree` merges without touching any working tree, which
    // is the whole reason it is used here: composing a base must never disturb
    // the checkout a person may be sitting in.
    // `--write-tree` with two commits lets git find the real merge base. An
    // earlier version passed `--merge-base integration` alongside `integration`
    // as one side, which makes the base equal that side, so the OTHER side's
    // tree won outright and the first dependency's files vanished. The fixture
    // for two dependencies is what caught it.
    const merged = await tryGit(repoRoot, ['merge-tree', '--write-tree', integration, branch]);
    if (merged === null) return abandon();
    const tree = merged.split('\n')[0]!;
    const commit = await tryGit(repoRoot, [
      'commit-tree',
      tree,
      '-p',
      integration,
      '-p',
      branch,
      '-m',
      `dokima base: ${branch}`,
    ]);
    if (commit === null) return abandon();
    await tryGit(repoRoot, ['update-ref', integration, commit]);
  }
  return true;
}
