/**
 * Branch protection chapter (SC-14, FR-I2): configures the connect-time
 * contract and re-reads it to detect drift, same shape as
 * github-protection.ts. Gitea protection rules are keyed by `rule_name`
 * (this adapter uses the branch name itself as the rule name — an exact,
 * non-glob rule), read/edited at `/branch_protections/{name}`, created at
 * the collection endpoint `/branch_protections`.
 *
 * Two structural deltas from GitHub, not adapter bugs:
 * - No `allow_deletions` field exists on Gitea's BranchProtection schema —
 *   a protected branch is undeletable by construction, so there is nothing
 *   to request and the live snapshot always reports `allowDeletions: false`.
 *   If a caller's connect-time contract asked for `allowDeletions: true`,
 *   that surfaces as honest drift rather than being silently accepted.
 * - `enforceAdmins` maps to `block_admin_merge_override`, the closest
 *   analog in Gitea's field set (blocks repo admins from bypassing
 *   protection on merge) — inferred from field naming since Gitea's
 *   swagger carries no prose description for this field.
 */
import {
  ForgeNotFoundError,
  type BranchProtectionDifference,
  type BranchProtectionDrift,
  type BranchProtectionRules,
  type BranchProtectionSnapshot,
  type RepoRef,
} from './types.js';
import { requestGiteaApi, requestGiteaApiOrNotFound } from './gitea-http.js';
import type {
  GiteaRuntime,
  RawBranchProtection,
  RawCreateBranchProtectionOption,
  RawEditBranchProtectionOption,
} from './gitea-types.js';

function protectionCollectionPath(ref: RepoRef): string {
  return `/repos/${ref.owner}/${ref.repo}/branch_protections`;
}

function protectionPath(ref: RepoRef, branch: string): string {
  return `${protectionCollectionPath(ref)}/${branch}`;
}

function toEditBody(rules: BranchProtectionRules): RawEditBranchProtectionOption {
  return {
    required_approvals: rules.requiredApprovingReviewCount,
    dismiss_stale_approvals: rules.dismissStaleReviews,
    enable_status_check: rules.requiredStatusChecks.length > 0,
    status_check_contexts: rules.requiredStatusChecks,
    block_on_outdated_branch: rules.requireStrictStatusChecks,
    block_admin_merge_override: rules.enforceAdmins,
    enable_force_push: rules.allowForcePushes,
  };
}

function toCreateBody(
  branch: string,
  rules: BranchProtectionRules,
): RawCreateBranchProtectionOption {
  return { rule_name: branch, branch_name: branch, ...toEditBody(rules) };
}

function toSnapshot(raw: RawBranchProtection): BranchProtectionSnapshot {
  return {
    requiredApprovingReviewCount: raw.required_approvals,
    dismissStaleReviews: raw.dismiss_stale_approvals,
    requiredStatusChecks: raw.status_check_contexts,
    requireStrictStatusChecks: raw.block_on_outdated_branch,
    enforceAdmins: raw.block_admin_merge_override,
    allowForcePushes: raw.enable_force_push,
    /** No Gitea field to read: protected branches cannot be deleted, so this is always false. */
    allowDeletions: false,
  };
}

export async function configureBranchProtection(
  runtime: GiteaRuntime,
  ref: RepoRef,
  branch: string,
  rules: BranchProtectionRules,
): Promise<void> {
  const existing = await requestGiteaApiOrNotFound<RawBranchProtection>(
    runtime,
    protectionPath(ref, branch),
    runtime.requestTimeoutMs,
  );
  if (existing) {
    await requestGiteaApi<RawBranchProtection>(
      runtime,
      protectionPath(ref, branch),
      { method: 'PATCH', body: JSON.stringify(toEditBody(rules)) },
      runtime.requestTimeoutMs,
    );
    return;
  }
  await requestGiteaApi<RawBranchProtection>(
    runtime,
    protectionCollectionPath(ref),
    { method: 'POST', body: JSON.stringify(toCreateBody(branch, rules)) },
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
  runtime: GiteaRuntime,
  ref: RepoRef,
  branch: string,
  expected: BranchProtectionRules,
): Promise<BranchProtectionDrift> {
  let raw: RawBranchProtection | undefined;
  try {
    raw = await requestGiteaApiOrNotFound<RawBranchProtection>(
      runtime,
      protectionPath(ref, branch),
      runtime.requestTimeoutMs,
    );
  } catch (err) {
    // requestGiteaApiOrNotFound only swallows 404 itself; a distinct
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
