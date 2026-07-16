/**
 * Branch protection chapter (SC-14, FR-I1): configures the connect-time
 * contract (reviewer != author via required_approving_review_count >= 1, no
 * force-push, required status checks) and re-reads it on demand to detect
 * drift — the parity validator SC-14 requires, distinct from W6-05's
 * dual-remote SHA parity.
 */
import {
  ForgeNotFoundError,
  type BranchProtectionDifference,
  type BranchProtectionDrift,
  type BranchProtectionRules,
  type BranchProtectionSnapshot,
  type RepoRef,
} from './types.js';
import { requestGitHubApi, requestGitHubApiOrNotFound } from './github-http.js';
import type {
  GitHubRuntime,
  RawBranchProtection,
  RawBranchProtectionRequest,
} from './github-types.js';

function protectionPath(ref: RepoRef, branch: string): string {
  return `/repos/${ref.owner}/${ref.repo}/branches/${branch}/protection`;
}

function toRequestBody(rules: BranchProtectionRules): RawBranchProtectionRequest {
  return {
    required_status_checks:
      rules.requiredStatusChecks.length > 0
        ? {
            strict: rules.requireStrictStatusChecks,
            contexts: rules.requiredStatusChecks,
          }
        : null,
    enforce_admins: rules.enforceAdmins,
    required_pull_request_reviews: {
      required_approving_review_count: rules.requiredApprovingReviewCount,
      dismiss_stale_reviews: rules.dismissStaleReviews,
    },
    restrictions: null,
    allow_force_pushes: rules.allowForcePushes,
    allow_deletions: rules.allowDeletions,
  };
}

function toSnapshot(raw: RawBranchProtection): BranchProtectionSnapshot {
  return {
    requiredApprovingReviewCount:
      raw.required_pull_request_reviews?.required_approving_review_count ?? 0,
    dismissStaleReviews:
      raw.required_pull_request_reviews?.dismiss_stale_reviews ?? false,
    requiredStatusChecks: raw.required_status_checks?.contexts ?? [],
    requireStrictStatusChecks: raw.required_status_checks?.strict ?? false,
    enforceAdmins: raw.enforce_admins?.enabled ?? false,
    allowForcePushes: raw.allow_force_pushes?.enabled ?? false,
    allowDeletions: raw.allow_deletions?.enabled ?? false,
  };
}

export async function configureBranchProtection(
  runtime: GitHubRuntime,
  ref: RepoRef,
  branch: string,
  rules: BranchProtectionRules,
): Promise<void> {
  await requestGitHubApi<RawBranchProtection>(
    runtime,
    protectionPath(ref, branch),
    { method: 'PUT', body: JSON.stringify(toRequestBody(rules)) },
    runtime.requestTimeoutMs,
  );
}

function setsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.some((value, index) => value !== sortedB[index]);
}

function diffSnapshot(
  expected: BranchProtectionRules,
  actual: BranchProtectionSnapshot,
): BranchProtectionDifference[] {
  const differences: BranchProtectionDifference[] = [];
  const compare = (field: string, expectedValue: unknown, actualValue: unknown): void => {
    if (expectedValue !== actualValue) {
      differences.push({ field, expected: expectedValue, actual: actualValue });
    }
  };

  compare(
    'requiredApprovingReviewCount',
    expected.requiredApprovingReviewCount,
    actual.requiredApprovingReviewCount,
  );
  compare(
    'dismissStaleReviews',
    expected.dismissStaleReviews,
    actual.dismissStaleReviews,
  );
  compare('enforceAdmins', expected.enforceAdmins, actual.enforceAdmins);
  compare('allowForcePushes', expected.allowForcePushes, actual.allowForcePushes);
  compare('allowDeletions', expected.allowDeletions, actual.allowDeletions);
  compare(
    'requireStrictStatusChecks',
    expected.requireStrictStatusChecks,
    actual.requireStrictStatusChecks,
  );
  if (setsDiffer(expected.requiredStatusChecks, actual.requiredStatusChecks)) {
    differences.push({
      field: 'requiredStatusChecks',
      expected: expected.requiredStatusChecks,
      actual: actual.requiredStatusChecks,
    });
  }
  return differences;
}

export async function checkBranchProtectionDrift(
  runtime: GitHubRuntime,
  ref: RepoRef,
  branch: string,
  expected: BranchProtectionRules,
): Promise<BranchProtectionDrift> {
  let raw: RawBranchProtection | undefined;
  try {
    raw = await requestGitHubApiOrNotFound<RawBranchProtection>(
      runtime,
      protectionPath(ref, branch),
      runtime.requestTimeoutMs,
    );
  } catch (err) {
    // requestGitHubApiOrNotFound only swallows 404 itself; a distinct
    // ForgeNotFoundError thrown by a differently-shaped failure is still
    // "protection is gone" from this validator's point of view.
    if (err instanceof ForgeNotFoundError) raw = undefined;
    else throw err;
  }

  if (!raw) {
    return {
      drifted: true,
      differences: [
        {
          field: '*',
          expected: 'branch protection configured per the connect-time contract',
          actual: 'no branch protection rule exists on this branch',
        },
      ],
    };
  }

  const differences = diffSnapshot(expected, toSnapshot(raw));
  return { drifted: differences.length > 0, differences };
}
