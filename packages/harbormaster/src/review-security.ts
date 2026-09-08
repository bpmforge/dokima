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

import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  checksPermitAutomaticCompletion,
  executableIsInstalled,
  runSecurityChecks,
  sandboxedToolRunner,
  type CheckEvidence,
  type NetworkPolicy,
  type ProjectProfile,
} from './security-checks.js';

export interface TicketSecurityChecksInput {
  readonly worktreePath: string;
  /** The reviewed head digest — the evidence is about one tree, and says which. */
  readonly sourceDigest: string;
  readonly networkPolicy: NetworkPolicy;
  readonly secretsValidatorPath?: string | null;
  readonly timeoutMs?: number;
}

export interface TicketSecurityChecks {
  readonly evidence: readonly CheckEvidence[];
  readonly eligible: boolean;
  readonly blockedBy: readonly string[];
}

const exists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

/**
 * MEASURED FROM THE WORKTREE, NEVER ASSERTED BY THE CALLER. The first draft of
 * this module took `hasNodeManifest`/`hasLockfile` as arguments and the review
 * path passed the literals `true` and `false` — which made `tool-deps` resolve
 * to NOT_APPLICABLE ("no lockfile") for every ticket on every project forever,
 * including projects with a lockfile sitting beside the manifest. That is the
 * precise defect this whole card exists to remove: a status derived from a
 * guess, wearing a runtime-derived reason. Applicability is a fact about the
 * tree, so it is read from the tree.
 */
async function profileOf(worktreePath: string): Promise<ProjectProfile> {
  const [manifest, npmLock, pnpmLock, yarnLock] = await Promise.all([
    exists(path.join(worktreePath, 'package.json')),
    exists(path.join(worktreePath, 'package-lock.json')),
    exists(path.join(worktreePath, 'pnpm-lock.yaml')),
    exists(path.join(worktreePath, 'yarn.lock')),
  ]);
  return {
    hasNodeManifest: manifest,
    hasLockfile: npmLock || pnpmLock || yarnLock,
    hasInfrastructureAsCode: false,
  };
}

export async function collectTicketSecurityChecks(
  input: TicketSecurityChecksInput,
): Promise<TicketSecurityChecks> {
  const evidence = await runSecurityChecks({
    cwd: input.worktreePath,
    sourceDigest: input.sourceDigest,
    profile: await profileOf(input.worktreePath),
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
