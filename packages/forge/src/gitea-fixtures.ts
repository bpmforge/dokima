/**
 * Recorded response fixtures for the Gitea adapter's contract tests
 * (docs/TESTING.md: "recorded fixtures, never live calls in CI"). Shapes
 * verified 2026-07-18 against the live Gitea OpenAPI spec fetched from
 * https://gitea.com/swagger.v1.json — see gitea-types.ts's file header for
 * the definitions cited.
 */

export const repoSuccessFixture = {
  full_name: 'shipwright-org/demo',
  default_branch: 'main',
  private: true,
  archived: false,
  permissions: { admin: true, push: true, pull: true },
};

export const repoMissingPermissionsFixture = {
  full_name: 'shipwright-org/demo',
  default_branch: 'main',
  private: true,
  archived: false,
};

export const repoNotFoundFixture = {
  status: 404,
  statusText: 'Not Found',
  body: JSON.stringify({ message: 'repository does not exist', url: '' }),
};

/** The contract this adapter configures on connect: dismiss stale reviews, one required approver, no force-push, required checks. */
export const connectTimeBranchProtectionFixture = {
  rule_name: 'main',
  required_approvals: 1,
  dismiss_stale_approvals: true,
  enable_status_check: true,
  status_check_contexts: ['ci/gate'],
  block_on_outdated_branch: true,
  block_admin_merge_override: true,
  enable_force_push: false,
};

/** Someone loosened required-approver count after connect — the drift the validator must catch. */
export const driftedApprovalCountFixture = {
  ...connectTimeBranchProtectionFixture,
  required_approvals: 0,
};

/** Someone re-enabled force-push after connect — SC-14's "no force-push" law violated. */
export const driftedForcePushFixture = {
  ...connectTimeBranchProtectionFixture,
  enable_force_push: true,
};

/** A required status-check context was silently dropped. */
export const driftedStatusChecksFixture = {
  ...connectTimeBranchProtectionFixture,
  status_check_contexts: [],
};

export const branchProtectionForbiddenFixture = {
  status: 403,
  statusText: 'Forbidden',
  body: JSON.stringify({ message: 'Must have admin rights to Repository.', url: '' }),
};

export const pullRequestSuccessFixture = {
  number: 42,
  state: 'open',
  title: 'feat(W6-02): Gitea adapter + generic git fallback',
  body: 'ticket body',
  html_url: 'https://gitea.example.com/shipwright-org/demo/pulls/42',
  merged: false,
  merge_commit_sha: null,
  user: { login: 'shipwright-maker' },
  head: { ref: 'sw/w6-02-gitea-adapter', sha: 'abc123def456' },
  base: { ref: 'main' },
};

export const pullRequestListFixture = [pullRequestSuccessFixture];

export const pullRequestMergedFixture = {
  ...pullRequestSuccessFixture,
  state: 'closed',
  merged: true,
  merge_commit_sha: 'deadbeefcafe',
};

export const mergeNotMergeableFixture = {
  status: 405,
  statusText: 'Method Not Allowed',
  body: JSON.stringify({ message: 'Pull Request is not mergeable', url: '' }),
};

export const mergeShaMismatchFixture = {
  status: 409,
  statusText: 'Conflict',
  body: JSON.stringify({ message: 'Head branch was modified', url: '' }),
};

export const issueSuccessFixture = {
  id: 1001,
  number: 7,
  state: 'open',
  title: 'W6-02 — Gitea adapter + generic git fallback',
  body: 'mirrored ticket body',
  html_url: 'https://gitea.example.com/shipwright-org/demo/issues/7',
  labels: [],
  assignees: [{ login: 'shipwright-maker' }],
};

export const issueClosedFixture = {
  ...issueSuccessFixture,
  state: 'closed',
};

export const issueLabelsAppliedFixture = [{ name: 'lane:integrations' }];

export const issueCommentSuccessFixture = {
  id: 5001,
  body: 'accepted — reviewer!=author verified',
  user: { login: 'shipwright-reviewer' },
  html_url: 'https://gitea.example.com/shipwright-org/demo/issues/7#issuecomment-5001',
  created_at: '2026-07-18T12:00:00Z',
};

export const commitStatusSuccessFixture = {
  id: 9001,
  status: 'success',
  context: 'shipwright/gate',
  created_at: '2026-07-18T12:05:00Z',
};

export const authUnauthorizedFixture = {
  status: 401,
  statusText: 'Unauthorized',
  body: JSON.stringify({ message: 'token is expired', url: '' }),
};

export const secondaryRateLimitFixture = {
  status: 429,
  statusText: 'Too Many Requests',
  headers: { 'retry-after': '30' },
  body: JSON.stringify({ message: 'rate limit exceeded', url: '' }),
};

export const serverErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({ message: 'Internal Server Error', url: '' }),
};

export const validationErrorFixture = {
  status: 422,
  statusText: 'Unprocessable Entity',
  body: JSON.stringify({ message: 'Validation Error', url: '' }),
};
