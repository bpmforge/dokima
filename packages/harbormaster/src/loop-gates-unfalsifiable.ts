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
  const probeId = baseProbeId(input.ticketId);
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
    /**
     * W22-14: clean up even when `createWorktree` never returned.
     *
     * `probePath` is only set once the create RESOLVES, so a create that threw
     * after making the directory left it behind with nothing to remove it —
     * and `dokima doctor` then reported a worktree for a ticket that was never
     * in progress. `baseProbePath` computes exactly the path we could not
     * obtain by other means, which is what it was written for and why it had
     * no caller until now.
     */
    const path_ = probePath ?? baseProbePath(input.repoRoot, input.ticketId);
    await destroyWorktree(
      { repoRoot: input.repoRoot, path: path_, branch: `sw/${probeId}`, ticketId: probeId },
      { deleteBranch: true },
    ).catch(() => undefined);
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

/**
 * The suffix that marks a worktree as this module's throwaway base probe.
 *
 * W22-14: `baseProbePath` was exported "so a stale one can be recognised" and
 * nothing recognised anything — it was reported by validate-exports as an
 * export with no caller, and the obvious answer was to mark it deliberately
 * unreached. That would have been wrong. There IS a recogniser: `dokima
 * doctor`'s worktree-orphans check, which lists every directory under
 * `.dokima/worktrees` that is not an in_progress ticket. A probe is never an
 * in_progress ticket, so a leftover one was already being reported — as a bare
 * directory name, indistinguishable from a ticket whose record had vanished.
 *
 * So the export was not decoration awaiting a marker; it was a wire that had
 * never been connected. The suffix is named once, here, and both the creator
 * and the recogniser use it.
 */
export const BASE_PROBE_SUFFIX = '--base-probe';

/** The worktree id this module gives its throwaway base checkout. */
export function baseProbeId(ticketId: string): string {
  return `${ticketId}${BASE_PROBE_SUFFIX}`;
}

/** True when a worktree directory name is one of these probes rather than a ticket's. */
export function isBaseProbeWorktree(name: string): boolean {
  return name.endsWith(BASE_PROBE_SUFFIX);
}

/** Where a base probe lives. Mirrors `createWorktree`'s own layout (packages/git/src/worktree.ts). */
export function baseProbePath(repoRoot: string, ticketId: string): string {
  return path.join(repoRoot, '.dokima', 'worktrees', baseProbeId(ticketId));
}
