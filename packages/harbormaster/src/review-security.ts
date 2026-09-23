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
  type UnauditedDependenciesPolicy,
} from './security-checks.js';
import { dependenciesUnchangedSince } from './review-deps.js';
import { archiveCheckout, removeBaselineCheckout } from './security-baseline.js';
import type { SastRuleset } from './sast-rules.js';

export interface TicketSecurityChecksInput {
  readonly worktreePath: string;
  /** The reviewed head digest — the evidence is about one tree, and says which. */
  readonly sourceDigest: string;
  readonly networkPolicy: NetworkPolicy;
  readonly secretsValidatorPath?: string | null;
  readonly timeoutMs?: number;
  /** W23-51: the pinned SAST ruleset; absent, SAST reports NOT RUN. */
  readonly sastRules?: SastRuleset | null;
  /**
   * W23-51: the commit this ticket forked from. Findings a scanner also reports
   * there are pre-existing and do not count against the ticket. Null (no base
   * recorded) keeps every finding on the head.
   */
  readonly baseCommit?: string | null;
  /** W23-56: the project's policy, read by the caller from the repository root. */
  readonly unauditedDependencies?: UnauditedDependenciesPolicy;
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
async function profileOf(
  worktreePath: string,
  baseCommit: string | null,
): Promise<ProjectProfile> {
  const [manifest, npmLock, pnpmLock, yarnLock, unchanged] = await Promise.all([
    exists(path.join(worktreePath, 'package.json')),
    exists(path.join(worktreePath, 'package-lock.json')),
    exists(path.join(worktreePath, 'pnpm-lock.yaml')),
    exists(path.join(worktreePath, 'yarn.lock')),
    baseCommit ? dependenciesUnchangedSince(worktreePath, baseCommit) : null,
  ]);
  return {
    hasNodeManifest: manifest,
    hasLockfile: npmLock || pnpmLock || yarnLock,
    hasInfrastructureAsCode: false,
    dependenciesUnchangedSinceBase: unchanged,
  };
}

export async function collectTicketSecurityChecks(
  input: TicketSecurityChecksInput,
): Promise<TicketSecurityChecks> {
  // The base is checked out at most once, and only when a check has findings
  // to compare — most reviews never pay for it.
  let baseDir: Promise<string | null> | null = null;
  const baseCommit = input.baseCommit ?? null;
  let evidence: readonly CheckEvidence[];
  try {
    evidence = await runSecurityChecks({
      cwd: input.worktreePath,
      sourceDigest: input.sourceDigest,
      profile: await profileOf(input.worktreePath, baseCommit),
      networkPolicy: input.networkPolicy,
      unauditedDependencies: input.unauditedDependencies ?? 'block',
      secretsValidatorPath: input.secretsValidatorPath ?? null,
      sastRules: input.sastRules ?? null,
      baseline: baseCommit
        ? {
            ref: baseCommit,
            checkout: () => (baseDir ??= archiveCheckout(input.worktreePath, baseCommit)),
          }
        : null,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      runTool: sandboxedToolRunner(),
      isInstalled: executableIsInstalled,
    });
  } finally {
    const dir = baseDir ? await baseDir : null;
    if (dir) await removeBaselineCheckout(dir);
  }
  const permit = checksPermitAutomaticCompletion(evidence);
  return { evidence, eligible: permit.eligible, blockedBy: permit.blockedBy };
}

/**
 * The reviewer's view of the objective checks. Every check appears, including
 * the ones that did not run — a reviewer shown only the passing rows would
 * read a missing scanner as a clean one, which is the failure this whole card
 * exists to remove.
 *
 * W23-51: AND A CHECK THAT DID NOT RUN IS NOT EVIDENCE AGAINST THE CHANGE. The
 * 2026-09-23 live review read "tool-sast: ERROR" as a mark against the diff and
 * answered CONTRADICTED 4/10 for a ticket whose re-run passed. A scanner that
 * could not run is missing coverage: it still blocks an automatic acceptance
 * (decideReview), and it is still never a pass, but the reviewer is told
 * plainly that it says nothing about this code either way.
 */
export function securityChecksSection(checks: TicketSecurityChecks): string {
  if (checks.evidence.length === 0) return 'Objective security checks: none configured.';
  const notRun = (c: CheckEvidence) => c.status === 'error' || c.status === 'unavailable';
  const rows = checks.evidence.map((c) => {
    const label = notRun(c)
      ? c.waived
        ? 'NOT RUN (waived)'
        : 'NOT RUN'
      : c.status.toUpperCase();
    const detail = c.reason
      ? ` — ${c.reason}`
      : c.findingCount > 0
        ? ` — ${c.findingCount} finding(s) introduced by this change`
        : '';
    return `- ${c.checkId}: ${label} (exit ${c.exitCode ?? 'none'})${detail}`;
  });
  const findings = checks.evidence.some((c) => c.status === 'findings');
  const missing = checks.evidence.some(notRun);
  const closing: string[] = [];
  if (checks.eligible) closing.push('Every required check ran and passed.');
  if (findings) {
    closing.push(
      'A FINDINGS row is about code this change introduced (findings already present at the ticket base are not counted) — weigh it as evidence about the diff.',
    );
  }
  if (missing) {
    closing.push(
      'A NOT RUN row means the tool could not run on this host. That is missing coverage: do not treat it as a clean result, and do not count it against this change either — judge the diff on the evidence you do have.',
    );
  }
  return [
    'Objective security checks, executed by the core (not by you, and not by the maker):',
    ...rows,
    ...closing,
  ].join('\n');
}

/**
 * What the `review.verdict` event records about the checks: what the CORE
 * executed, beside what the model said about it (W23-04). W23-51 adds the
 * baseline facts and the rule digest, so a pass that rests on "pre-existing at
 * base" says so and names the rules it was about.
 */
export function securityChecksPayload(
  checks: TicketSecurityChecks,
): readonly Record<string, unknown>[] {
  return checks.evidence.map((c) => ({
    checkId: c.checkId,
    status: c.status,
    exitCode: c.exitCode,
    findingCount: c.findingCount,
    reason: c.reason,
    ...(c.preexistingCount === undefined
      ? {}
      : { preexistingCount: c.preexistingCount, baselineRef: c.baselineRef ?? null }),
    ...(c.ruleDigest ? { ruleDigest: c.ruleDigest } : {}),
    ...(c.waived ? { waived: c.waived } : {}),
  }));
}
