/**
 * The onboard side of the security tool registry (W23-04, AB-04).
 *
 * `onboard-run.ts` calls this before dispatching a single specialist, so the
 * `security-sast` / `security-secrets` / `security-deps` steps interpret
 * REAL tool output instead of describing a scan that never happened. The
 * registry itself lives in `@dokima/harbormaster`; this module is only the
 * part that knows things `apps/server` knows and the package must not: where
 * the bundled validator lives in an installed distribution, what this
 * project's network policy is, and how to ledger the result.
 *
 * EVERY OUTCOME IS RECORDED, INCLUDING THE ONES THAT DID NOTHING. A tool that
 * was missing, timed out or could not reach its advisory database appends the
 * same event as one that passed, with its own status — because "no scanner
 * ran" is precisely the state that used to be invisible, and a specialist
 * reading an empty section cannot tell it from a clean project.
 */

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { appendEvent, type EventLog } from '@dokima/events';
import {
  checksPermitAutomaticCompletion,
  executableIsInstalled,
  runSecurityChecks,
  sandboxedToolRunner,
  type CheckEvidence,
  type NetworkPolicy,
  type ProjectProfile,
} from '@dokima/harbormaster';
import { resolveAsset } from '@dokima/shared';
import { OPERATOR_ACTOR_ID } from '../server/board-actor.js';

export const SECURITY_CHECKS_EVENT = 'security.checks_completed';

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * What the project IS, measured rather than assumed. Applicability has to come
 * from the tree: "this project has no lockfile" is a fact about the project,
 * while "npm is not installed" is a fact about the host, and the plan is
 * explicit that only the first may read as NOT_APPLICABLE.
 */
async function profileOf(projectPath: string): Promise<ProjectProfile> {
  const [manifest, npmLock, pnpmLock, yarnLock] = await Promise.all([
    exists(path.join(projectPath, 'package.json')),
    exists(path.join(projectPath, 'package-lock.json')),
    exists(path.join(projectPath, 'pnpm-lock.yaml')),
    exists(path.join(projectPath, 'yarn.lock')),
  ]);
  return {
    hasNodeManifest: manifest,
    hasLockfile: npmLock || pnpmLock || yarnLock,
    hasInfrastructureAsCode: false,
  };
}

/**
 * The bundled secrets scanner, in whatever shape this installation has.
 *
 * W23-16: exported, because the REVIEW path needs the same answer and had no
 * way to get it. `ReviewPassOptions.secretsValidatorPath` existed from W23-04
 * and no production caller ever set it, so `tool-secrets` reported "could not
 * be located in this installation" on every ticket ever reviewed — a parameter
 * added for a caller that was never written.
 * `resolveAsset` is the same resolver the packaged CLI uses for `content/`,
 * so a scanner that is missing from a real install is reported as missing
 * instead of silently skipped — the exact class of defect the 0.1.0 changelog
 * records for the validator pack.
 */
export async function bundledSecretsScanner(): Promise<string | null> {
  const candidate = resolveAsset('content', 'validators', 'secrets-scan.sh');
  return (await exists(candidate)) ? candidate : null;
}

/**
 * The project's network policy.
 *
 * W23-16: exported for the same reason. The review path hardcoded
 * `'local-only'` with a comment saying it had no settings reader — and since
 * `tool-sast` requires the network for its ruleset, that made the SAST check
 * permanently UNAVAILABLE, every required check therefore failed, and NO
 * TICKET COULD EVER BE MACHINE-ACCEPTED. The policy is the user's choice to
 * make, in both places, from the same file.
 *
 * Local-only is a CHOICE a user makes and this
 * function's job is to report it honestly, not to improve on it: under
 * local-only the dependency audit reports its missing coverage rather than
 * reaching a cloud advisory service (Law 9b).
 */
export async function networkPolicyOf(projectPath: string): Promise<NetworkPolicy> {
  try {
    const raw = await readFile(
      path.join(projectPath, '.dokima', 'settings.json'),
      'utf8',
    );
    const settings = JSON.parse(raw) as Record<string, unknown>;
    return settings['modelPolicy.localOnly'] === true ? 'local-only' : 'network-allowed';
  } catch {
    // No settings file is a first run, and a first run has made no choice. The
    // conservative reading is the one that cannot surprise a user with a
    // network call: local-only, with the missing coverage stated.
    return 'local-only';
  }
}

export interface OnboardSecurityChecksResult {
  readonly evidence: readonly CheckEvidence[];
  readonly eligible: boolean;
  readonly blockedBy: readonly string[];
}

export async function runOnboardSecurityChecks(
  projectPath: string,
  log: EventLog,
  runId: string,
): Promise<OnboardSecurityChecksResult> {
  const evidence = await runSecurityChecks({
    cwd: projectPath,
    // Onboard analyses a working tree rather than a committed range; the
    // digest is the project path plus its profile, which is enough to bind
    // this evidence to this run and no more than the runtime actually knows.
    sourceDigest: `onboard:${runId}`,
    profile: await profileOf(projectPath),
    networkPolicy: await networkPolicyOf(projectPath),
    secretsValidatorPath: await bundledSecretsScanner(),
    runTool: sandboxedToolRunner(),
    isInstalled: executableIsInstalled,
  });

  const permit = checksPermitAutomaticCompletion(evidence);

  appendEvent(log, {
    eventType: SECURITY_CHECKS_EVENT,
    actorId: OPERATOR_ACTOR_ID,
    runId,
    payload: {
      checks: evidence.map((c) => ({
        checkId: c.checkId,
        status: c.status,
        exitCode: c.exitCode,
        findingCount: c.findingCount,
        reason: c.reason,
        inputDigest: c.inputDigest,
        artifactDigest: c.artifactDigest,
        durationMs: c.durationMs,
      })),
      eligible: permit.eligible,
      blockedBy: permit.blockedBy,
    },
  });

  return { evidence, eligible: permit.eligible, blockedBy: permit.blockedBy };
}
