/**
 * R-B2 evidence primitives (BLUEPRINT §2.2, FR-L6, docs/design/FINDING_LOOP_POLICY.md §1):
 * "every reviewer/challenger verdict must carry a `re-ran independently: <command, counts,
 * exit code>` evidence line; a verdict without one is INCOMPLETE and is bounced, not counted."
 *
 * `packages/loop/src/findings-types.ts` already implements this exact shape for the finding
 * ledger's recheck verdicts. This ticket's write_scope is `packages/pipeline/src/challenger/**`
 * only — `packages/pipeline/package.json` (where a workspace dependency on `@dokima/loop`
 * would be declared) is out of glob, so pnpm never links the sibling package here (confirmed
 * precedent: `packages/pipeline/src/phases/types.ts`'s identical header). This module mirrors
 * `RerunEvidence`/`isValidRerun`/`formatRerunLine` field-for-field so a future wiring ticket can
 * bind the real primitive in unchanged, never duplicating ledger state — only the evidence shape.
 */

export interface RerunEvidence {
  readonly command: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly exitCode: number;
}

export function isValidRerun(
  rerun: RerunEvidence | null | undefined,
): rerun is RerunEvidence {
  return (
    rerun != null &&
    typeof rerun.command === 'string' &&
    rerun.command.trim().length > 0 &&
    Number.isInteger(rerun.exitCode) &&
    typeof rerun.counts === 'object' &&
    rerun.counts !== null &&
    Object.keys(rerun.counts).length > 0
  );
}

/** Renders the literal `re-ran independently: ...` evidence line R-B2 requires on every counted verdict. */
export function formatRerunLine(rerun: RerunEvidence): string {
  return `re-ran independently: ${rerun.command}, counts=${JSON.stringify(rerun.counts)}, exit ${rerun.exitCode}`;
}
