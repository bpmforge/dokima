/**
 * Gitea REST wire shapes + adapter config/runtime context (FR-I2, W6-02).
 *
 * Schemas verified 2026-07-18 against the live Gitea OpenAPI spec fetched
 * from https://gitea.com/swagger.v1.json (definitions: Repository,
 * Permission, BranchProtection, CreateBranchProtectionOption,
 * EditBranchProtectionOption, PullRequest, PRBranchInfo,
 * CreatePullRequestOption, EditPullRequestOption, MergePullRequestOption,
 * Issue, CreateIssueOption, EditIssueOption, Comment,
 * CreateIssueCommentOption, CommitStatus, CreateStatusOption) and
 * https://docs.gitea.com/development/api-usage (auth header format, base
 * path). Contract tests pin every shape via recorded fixtures
 * (gitea-fixtures.ts), never a live call (docs/TESTING.md).
 *
 * Key deltas from the GitHub adapter (github-types.ts), all load-bearing:
 * - Auth header is `Authorization: token <token>` (literal word "token"),
 *   not `Bearer <token>`.
 * - No API-version header — Gitea has no GitHub-style apiVersion pinning.
 * - Branch protection has no `allow_deletions` toggle: a protected branch
 *   is structurally undeletable, so there is nothing to configure or read
 *   back (gitea-protection.ts's snapshot always reports `false`).
 * - PR merge (`POST .../pulls/{index}/merge`) returns an empty 200 body
 *   (`#/responses/empty`), not a JSON result — gitea-pr.ts re-fetches the
 *   PR afterward for `merge_commit_sha`/`merged`.
 * - No native rate-limit signal (no `x-ratelimit-*` headers); a 429 is only
 *   possible via a reverse proxy in front of the instance, so only
 *   `Retry-After` is honored, never a primary-limit header.
 */
import type { ForgeIdentity } from './types.js';

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface GiteaAdapterConfig {
  id?: string;
  /** Root URL of the Gitea instance, e.g. "https://gitea.example.com" (no trailing "/api/v1"). */
  baseUrl: string;
  /** Pre-resolved token for the `maker` identity — never read from a keychain here. */
  makerToken: string;
  /** Pre-resolved token for the `reviewer` identity; omit if this instance never merges. */
  reviewerToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * Per-instance context threaded through every gitea-*.ts chapter. Not
 * pinned to one repo — the ForgeAdapter contract takes a RepoRef on every
 * call, so one credentialed instance can act across every repo its tokens
 * can reach, same as GitHubRuntime (github-types.ts).
 */
export interface GiteaRuntime {
  readonly id: string;
  readonly apiBaseUrl: string;
  readonly makerToken: string;
  readonly reviewerToken: string | undefined;
  readonly now: () => number;
  readonly requestTimeoutMs: number;
  tokenFor(identity: ForgeIdentity): string;
  fetchRaw(url: string, init: RequestInit, timeoutMs: number): Promise<Response>;
  throwHttpError(response: Response): Promise<never>;
}

// ---- Raw response shapes (only the fields this adapter reads) ----

export interface RawPermission {
  admin: boolean;
  push: boolean;
  pull: boolean;
}

export interface RawRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
  permissions?: RawPermission;
}

export interface RawBranchProtection {
  rule_name: string;
  required_approvals: number;
  dismiss_stale_approvals: boolean;
  enable_status_check: boolean;
  status_check_contexts: string[];
  block_on_outdated_branch: boolean;
  /** Best-fit analog of GitHub's `enforce_admins`: blocks repo admins from bypassing protection via merge override. */
  block_admin_merge_override: boolean;
  enable_force_push: boolean;
}

export interface RawCreateBranchProtectionOption {
  rule_name: string;
  branch_name: string;
  required_approvals: number;
  dismiss_stale_approvals: boolean;
  enable_status_check: boolean;
  status_check_contexts: string[];
  block_on_outdated_branch: boolean;
  block_admin_merge_override: boolean;
  enable_force_push: boolean;
}

export type RawEditBranchProtectionOption = Omit<
  RawCreateBranchProtectionOption,
  'rule_name' | 'branch_name'
>;

export interface RawPRBranchInfo {
  ref: string;
  sha: string;
}

export interface RawPullRequest {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string | null;
  html_url: string;
  merged: boolean;
  merge_commit_sha: string | null;
  user: { login: string } | null;
  head: RawPRBranchInfo;
  base: RawPRBranchInfo;
}

export interface RawIssueLabel {
  name: string;
}

export interface RawIssue {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string | null;
  html_url: string;
  labels: RawIssueLabel[] | null;
  assignees: Array<{ login: string }> | null;
  /** Gitea has no distinct "close reason" field on the wire (unlike GitHub's state_reason) — inferred client-side from the update request. */
}

export interface RawComment {
  id: number;
  body: string;
  user: { login: string } | null;
  html_url: string;
  created_at: string;
}

export interface RawCommitStatus {
  id: number;
  status: 'pending' | 'success' | 'error' | 'failure' | 'warning' | 'skipped';
  context: string;
  created_at: string;
}
