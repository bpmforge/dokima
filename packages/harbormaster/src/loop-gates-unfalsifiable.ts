/**
 * loop-gates-unfalsifiable.ts — a check that already passed proves nothing
 * (W21-50).
 *
 * I wrote two of these myself with W21-48's `add-ticket`, an hour apart, and
 * the gate had nothing to say about either.
 *
 * PLAN-vault-001a — "Test infrastructure: node --test must run TypeScript
 * specs", owning package.json and tsconfig.json — was given the acceptance
 * `npm run typecheck`. It landed in two attempts having changed ONE line of
 * package.json and never touched tsconfig.json. It was right to: typecheck
 * passes on that worktree whether or not test infrastructure works, so the
 * criterion could not distinguish the ticket being done from the ticket being
 * untouched. I then wrote the same criterion onto PLAN-vault-001b and accepted
 * that one by reading its diff, because the gate again told me nothing.
 *
 * W21-41 catches the test-runner version of this — a command that exits 0
 * having run zero tests. This is the general case: a criterion whose result is
 * the same before and after the work is not an acceptance criterion, whatever
 * the command is.
 *
 * IT IS CHECKED ONLY FOR CRITERIA THAT PASSED, and that is what keeps it
 * affordable. A failing criterion is already refusing the close, so what it
 * would have done at base is irrelevant; and the expensive half — a second
 * worktree and a second run of the command — happens only where a pass is
 * about to certify a ticket.
 *
 * THE BASE, NOT THE PREVIOUS COMMIT. The question is whether the TICKET's work
 * made the difference, so the comparison point is the tree the ticket forked
 * from — the same `baseRef` the close gate already resolves for its diff.
 */
import { createWorktree, destroyWorktree } from '@dokima/git';
import path from 'node:path';
import { reRunVerify } from './loop-gates-verify.js';
import type { AcceptanceRun } from './loop-gates-acceptance.js';

export interface UnfalsifiableCriterion {
  readonly id: string;
  readonly command: string;
}

/**
 * Passing criteria that ALSO pass against the base — they certify nothing
 * about this ticket. Criteria that failed are skipped: the gate is already
 * refusing on them.
 */
export async function unfalsifiableCriteria(input: {
  readonly repoRoot: string;
  readonly ticketId: string;
  readonly baseRef: string;
  readonly runs: readonly AcceptanceRun[];
  readonly timeoutMs: number;
}): Promise<UnfalsifiableCriterion[]> {
  const passed = input.runs.filter((r) => r.exitCode === 0 && !r.ranNothing);
  if (passed.length === 0) return [];

  // A throwaway checkout of the base. `createWorktree` names it after the
  // ticket, so a distinct id keeps it clear of the ticket's real worktree.
  const probeId = `${input.ticketId}--base-probe`;
  let probePath: string | undefined;
  const found: UnfalsifiableCriterion[] = [];
  try {
    const probe = await createWorktree({
      repoRoot: input.repoRoot,
      ticketId: probeId,
      slug: 'base probe',
      baseRef: input.baseRef as Parameters<typeof createWorktree>[0]['baseRef'],
    });
    probePath = probe.path;
    for (const run of passed) {
      const atBase = await reRunVerify(probe.path, run.command, input.timeoutMs);
      if (atBase.exitCode === 0) found.push({ id: run.id, command: run.command });
    }
    await destroyWorktree(probe, { deleteBranch: true });
  } catch {
    /**
     * A probe that cannot be built tells us nothing, and MUST NOT refuse a
     * ticket on that account — this check exists to make the gate more honest,
     * not to add a new way for real work to be rejected by infrastructure.
     */
    if (probePath) {
      await destroyWorktree(
        { repoRoot: input.repoRoot, path: probePath, branch: `sw/${probeId}`, ticketId: probeId },
        { deleteBranch: true },
      ).catch(() => undefined);
    }
    return [];
  }
  return found;
}

/** The gate reason, naming the criterion and what would fix it. */
export function unfalsifiableReason(found: readonly UnfalsifiableCriterion[]): string[] {
  return found.map(
    (item) =>
      `acceptance criterion ${item.id} proves nothing: \`${item.command}\` passes ` +
      `against this ticket's BASE too, so it returns the same answer whether or ` +
      `not the work was done. Give the ticket a criterion that FAILS before the ` +
      `work and passes after it.`,
  );
}

/** Where a base probe would live — exported so a stale one can be recognised. */
export function baseProbePath(repoRoot: string, ticketId: string): string {
  return path.join(repoRoot, '.dokima', 'worktrees', `${ticketId}--base-probe`);
}
