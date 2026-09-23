/**
 * loop-land-session-derive.ts — what the derived-manifest path says, and when
 * it is worth asking at all (W23-35, W23-41).
 *
 * Chapter of `loop-land-session.ts`, split when W23-41 took that file past the
 * 400-line CODE_BOOK_PROTOCOL cap. Extraction plus the W23-41 additions; the
 * decision itself stays in `attemptOnce`.
 */
import type { InfraFailureKind } from '@dokima/loop';
import { commitsSince, resolveForkPoint } from './loop-gates-verify.js';

/**
 * The ticket-history row a derivation writes before the gate runs (W23-35).
 *
 * Deliberately a `ticket.commented` event rather than a new event type or a
 * new receipt field: the gate already copies `manifest.evidence` into the
 * close receipt's payload verbatim, so the receipt half of acceptance 2 costs
 * the gate nothing, and `commentTicket` is the row the gate itself writes for
 * every refusal. Two existing channels, no new trust mode.
 */
export function derivedManifestNotice(
  files: readonly string[],
  commits: readonly string[],
  /** W23-41: set when the session ended in an infrastructure failure. */
  infraFailure: InfraFailureKind | null = null,
): string {
  return [
    'Completion Manifest DERIVED BY THE HARNESS (derivedBy: harness, W23-35).',
    'This session returned no manifest; every executable acceptance criterion',
    'passed in the worktree, so the manifest below was derived from git and',
    'submitted to the ordinary close gate, which verifies it exactly as it',
    "verifies an agent's — the manifest was never the thing the gate trusted.",
    ...(infraFailure
      ? [
          `The session itself ended in an infrastructure failure (${infraFailure}, W23-41);`,
          "the evidence is the worktree's, not the session's.",
        ]
      : []),
    `- commits: ${commits.length}`,
    `- files: ${files.join(', ')}`,
  ].join('\n');
}

/**
 * W23-41: whether the ticket branch has any commit since its fork point — the
 * cheap question that lets an infra failure over an untouched worktree skip
 * provisioning and the criteria entirely. `deriveManifest` declines on zero
 * commits anyway; this only avoids paying for the criteria to learn it.
 */
export async function hasCommitsSinceBase(
  worktreePath: string,
  baseRef: string,
): Promise<boolean> {
  try {
    const base = await resolveForkPoint(worktreePath, baseRef);
    return (await commitsSince(worktreePath, base)).length > 0;
  } catch {
    // No fork point: deriveManifest would decline too.
    return false;
  }
}
