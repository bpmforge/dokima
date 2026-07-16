/**
 * GitHub REST wire shapes + adapter config/runtime context.
 *
 * Endpoint shapes verified 2026-07-16 via WebFetch against docs.github.com
 * (apiVersion=2022-11-28): repos ("Get a repository"), branch protection
 * ("Get/Update branch protection"), pulls ("Create/List/Get/Update a pull
 * request", "Merge a pull request"), issues ("Create/Update an issue",
 * "Create an issue comment"), commits ("Create a commit status"), and
 * authentication ("Authenticating to the REST API" — Authorization: Bearer
 * <token>, Accept: application/vnd.github+json, X-GitHub-Api-Version) and
 * rate-limit docs ("Rate limits for the REST API" — primary limits signal
 * via x-ratelimit-remaining/x-ratelimit-reset at 403 or 429; secondary/abuse
 * limits via a retry-after header, also at 403 or 429).
 */
import type { ForgeIdentity } from './types.js';

export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface GitHubAdapterConfig {
  id?: string;
  /** Pre-resolved token for the `maker` identity — never read from a keychain here. */
  makerToken: string;
  /** Pre-resolved token for the `reviewer` identity; omit if this instance never merges. */
  reviewerToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
  apiBaseUrl?: string;
  apiVersion?: string;
}

/**
 * Per-instance context threaded through every github-*.ts chapter. Not
 * pinned to one repo — the ForgeAdapter contract takes a RepoRef on every
 * call, so one credentialed instance can act across every repo its tokens
 * can reach, same as a plain GitHub API client would.
 */
export interface GitHubRuntime {
  readonly id: string;
  readonly apiBaseUrl: string;
  readonly apiVersion: string;
  readonly makerToken: string;
  readonly reviewerToken: string | undefined;
  readonly now: () => number;
  readonly requestTimeoutMs: number;
  tokenFor(identity: ForgeIdentity): string;
  fetchRaw(url: string, init: RequestInit, timeoutMs: number): Promise<Response>;
  throwHttpError(response: Response): Promise<never>;
}

// ---- Raw response shapes (only the fields this adapter reads) ----

export interface RawRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
}

export interface RawRequiredStatusChecks {
  strict: boolean;
  contexts: string[];
}

export interface RawRequiredPullRequestReviews {
  required_approving_review_count: number;
  dismiss_stale_reviews: boolean;
}

export interface RawBranchProtection {
  required_status_checks: RawRequiredStatusChecks | null;
  enforce_admins: { enabled: boolean } | null;
  required_pull_request_reviews: RawRequiredPullRequestReviews | null;
  allow_force_pushes: { enabled: boolean } | null;
  allow_deletions: { enabled: boolean } | null;
}

export interface RawBranchProtectionRequest {
  required_status_checks: { strict: boolean; contexts: string[] } | null;
  enforce_admins: boolean | null;
  required_pull_request_reviews: {
    required_approving_review_count: number;
    dismiss_stale_reviews: boolean;
  } | null;
  restrictions: null;
  required_linear_history?: boolean;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
}

export interface RawPullRequest {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string | null;
  html_url: string;
  merged: boolean;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
}

export interface RawMergeResult {
  sha: string;
  merged: boolean;
  message: string;
}

export interface RawIssue {
  number: number;
  state: 'open' | 'closed';
  state_reason: 'completed' | 'not_planned' | 'reopened' | null;
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<string | { name?: string }>;
  assignees: Array<{ login: string }> | null;
}

export interface RawIssueComment {
  id: number;
  body: string;
  user: { login: string } | null;
  html_url: string;
  created_at: string;
}

export interface RawCommitStatus {
  id: number;
  state: 'pending' | 'success' | 'error' | 'failure';
  context: string;
  created_at: string;
}
