/**
 * Recorded response fixtures for the GitHub adapter's contract tests
 * (docs/TESTING.md: "recorded fixtures, never live calls in CI"). Shapes
 * verified 2026-07-16 via WebFetch against docs.github.com
 * (apiVersion=2022-11-28) — see github.ts's file header for the pages cited.
 */

export const repoSuccessFixture = {
  full_name: 'dokima-org/demo',
  default_branch: 'main',
  private: true,
  archived: false,
  permissions: { admin: true, push: true, pull: true },
};

export const repoMissingPermissionsFixture = {
  full_name: 'dokima-org/demo',
  default_branch: 'main',
  private: true,
  archived: false,
};

export const repoNotFoundFixture = {
  status: 404,
  statusText: 'Not Found',
  body: JSON.stringify({
    message: 'Not Found',
    documentation_url: 'https://docs.github.com/rest/repos/repos#get-a-repository',
  }),
};

/** The contract this adapter configures on connect: dismiss stale reviews, one required approver, no force-push, required checks. */
export const connectTimeBranchProtectionFixture = {
  required_status_checks: { strict: true, contexts: ['ci/gate'] },
  enforce_admins: { enabled: true },
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
  },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
};

/** Someone loosened required-approver count after connect — the drift the validator must catch. */
export const driftedApprovalCountFixture = {
  ...connectTimeBranchProtectionFixture,
  required_pull_request_reviews: {
    required_approving_review_count: 0,
    dismiss_stale_reviews: true,
  },
};

/** Someone re-enabled force-push after connect — SC-14's "no force-push" law violated. */
export const driftedForcePushFixture = {
  ...connectTimeBranchProtectionFixture,
  allow_force_pushes: { enabled: true },
};

/** A required status-check context was silently dropped. */
export const driftedStatusChecksFixture = {
  ...connectTimeBranchProtectionFixture,
  required_status_checks: { strict: true, contexts: [] },
};

export const branchProtectionForbiddenFixture = {
  status: 403,
  statusText: 'Forbidden',
  body: JSON.stringify({
    message: 'Must have admin rights to Repository.',
    documentation_url:
      'https://docs.github.com/rest/branches/branch-protection#update-branch-protection',
  }),
};

export const pullRequestSuccessFixture = {
  number: 42,
  state: 'open',
  title: 'feat(W6-01): forge framework + GitHub adapter',
  body: 'ticket body',
  html_url: 'https://github.com/dokima-org/demo/pull/42',
  merged: false,
  user: { login: 'dokima-maker' },
  head: { ref: 'sw/w6-01-github-adapter', sha: 'abc123def456' },
  base: { ref: 'main' },
};

export const pullRequestListFixture = [pullRequestSuccessFixture];

export const pullRequestMergedFixture = {
  ...pullRequestSuccessFixture,
  state: 'closed',
  merged: true,
};

export const mergeSuccessFixture = {
  sha: 'deadbeefcafe',
  merged: true,
  message: 'Pull Request successfully merged',
};

export const mergeNotMergeableFixture = {
  status: 405,
  statusText: 'Method Not Allowed',
  body: JSON.stringify({ message: 'Pull Request is not mergeable' }),
};

export const mergeShaMismatchFixture = {
  status: 409,
  statusText: 'Conflict',
  body: JSON.stringify({ message: 'Head branch was modified' }),
};

export const issueSuccessFixture = {
  id: 1001,
  number: 7,
  state: 'open',
  state_reason: null,
  title: 'W6-01 — Forge framework + GitHub adapter (PRs, protection, webhooks)',
  body: 'mirrored ticket body',
  html_url: 'https://github.com/dokima-org/demo/issues/7',
  labels: [{ name: 'lane:integrations' }],
  assignees: [{ login: 'dokima-maker' }],
};

export const issueClosedFixture = {
  ...issueSuccessFixture,
  state: 'closed',
  state_reason: 'completed',
};

export const issueCommentSuccessFixture = {
  id: 5001,
  body: 'accepted — reviewer!=author verified',
  user: { login: 'dokima-reviewer' },
  html_url: 'https://github.com/dokima-org/demo/issues/7#issuecomment-5001',
  created_at: '2026-07-16T12:00:00Z',
};

export const commitStatusSuccessFixture = {
  id: 9001,
  state: 'success',
  context: 'dokima/gate',
  created_at: '2026-07-16T12:05:00Z',
};

export const authUnauthorizedFixture = {
  status: 401,
  statusText: 'Unauthorized',
  body: JSON.stringify({ message: 'Bad credentials' }),
};

export const primaryRateLimitFixture = {
  status: 403,
  statusText: 'Forbidden',
  headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' },
  body: JSON.stringify({
    message: 'API rate limit exceeded for xxx.xxx.xxx.xxx.',
    documentation_url:
      'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api',
  }),
};

export const secondaryRateLimitFixture = {
  status: 429,
  statusText: 'Too Many Requests',
  headers: { 'retry-after': '30' },
  body: JSON.stringify({
    message: 'You have exceeded a secondary rate limit. Please wait a few minutes.',
  }),
};

export const serverErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({ message: 'Internal Server Error' }),
};

export const validationErrorFixture = {
  status: 422,
  statusText: 'Unprocessable Entity',
  body: JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }],
  }),
};
