/**
 * The build side of the security tool registry (W23-04) — the same checks the
 * onboard path runs, pointed at one ticket's worktree.
 *
 * SAME REGISTRY, NOT A SECOND ONE. `apps/server`'s onboard wiring and this
 * module both call `runSecurityChecks`; what differs is only what each knows
 * about its own caller (a project root and its settings there, a ticket's
 * worktree and its reviewed head here). Two registries would drift, and the
 * one that drifted would be the one nobody watched.
 *
 * PER TICKET, NOT PER BOARD (IMPLEMENTATION_PLAN §5): the checks run directly
 * against the captured worktree snapshot rather than re-running seven general
 * onboarding model sessions for every ticket.
 */

import {
  checksPermitAutomaticCompletion,
  executableIsInstalled,
  runSecurityChecks,
  sandboxedToolRunner,
  type CheckEvidence,
  type NetworkPolicy,
} from './security-checks.js';

export interface TicketSecurityChecksInput {
  readonly worktreePath: string;
  /** The reviewed head digest — the evidence is about one tree, and says which. */
  readonly sourceDigest: string;
  readonly networkPolicy: NetworkPolicy;
  readonly secretsValidatorPath?: string | null;
  readonly hasNodeManifest: boolean;
  readonly hasLockfile: boolean;
  readonly timeoutMs?: number;
}

export interface TicketSecurityChecks {
  readonly evidence: readonly CheckEvidence[];
  readonly eligible: boolean;
  readonly blockedBy: readonly string[];
}

export async function collectTicketSecurityChecks(
  input: TicketSecurityChecksInput,
): Promise<TicketSecurityChecks> {
  const evidence = await runSecurityChecks({
    cwd: input.worktreePath,
    sourceDigest: input.sourceDigest,
    profile: {
      hasNodeManifest: input.hasNodeManifest,
      hasLockfile: input.hasLockfile,
      hasInfrastructureAsCode: false,
    },
    networkPolicy: input.networkPolicy,
    secretsValidatorPath: input.secretsValidatorPath ?? null,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    runTool: sandboxedToolRunner(),
    isInstalled: executableIsInstalled,
  });
  const permit = checksPermitAutomaticCompletion(evidence);
  return { evidence, eligible: permit.eligible, blockedBy: permit.blockedBy };
}

/**
 * The reviewer's view of the objective checks. Every check appears, including
 * the ones that did not run — a reviewer shown only the passing rows would
 * read a missing scanner as a clean one, which is the failure this whole card
 * exists to remove.
 */
export function securityChecksSection(checks: TicketSecurityChecks): string {
  if (checks.evidence.length === 0) return 'Objective security checks: none configured.';
  const rows = checks.evidence.map((c) => {
    const detail = c.reason
      ? ` — ${c.reason}`
      : c.findingCount > 0
        ? ` — ${c.findingCount} finding(s)`
        : '';
    return `- ${c.checkId}: ${c.status.toUpperCase()} (exit ${c.exitCode ?? 'none'})${detail}`;
  });
  return [
    'Objective security checks, executed by the core (not by you, and not by the maker):',
    ...rows,
    checks.eligible
      ? 'Every required check ran and passed.'
      : 'At least one required check did not pass or did not run. A tool that could not run is NOT a clean result, and you must not treat it as one.',
  ].join('\n');
}
