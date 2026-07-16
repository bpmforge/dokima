/**
 * GitHub forge adapter (FR-I1, W6-01): repo ops, branch protection + drift
 * validator (SC-14), PR lifecycle, issue mirror primitives, commit status,
 * identity/token management.
 *
 * Book-style split (matches packages/gateway/src/providers/copilot.ts's
 * 400-line-cap precedent): github-types.ts (wire shapes + config + runtime
 * context), github-http.ts (fetch/timeout plumbing + status->error mapping),
 * github-repo.ts, github-protection.ts, github-pr.ts, github-issues.ts,
 * github-status.ts (one chapter per contract area). This file is the barrel:
 * GitHubForgeAdapter implements the generic ForgeAdapter contract
 * (types.ts, docs/design/CONTRACTS.md §2) and is the only place that owns
 * per-instance state (the runtime context, its tokens).
 *
 * One adapter instance is not pinned to a single repo: every ForgeAdapter
 * method takes a RepoRef, so a credentialed instance can act on any repo
 * its tokens can reach — same shape a plain API client would have.
 *
 * Two scoped identities (FR-I1, SC-03/SC-14): `maker` for routine writes,
 * `reviewer` for merges. Both tokens arrive pre-resolved in config — this
 * adapter never touches a keychain (same discipline as
 * packages/gateway/src/providers/copilot.ts). packages/forge/package.json
 * declares no dependencies (out of this ticket's write_scope to add one),
 * so this package cannot import @shipwright/shared's CredentialStore even
 * though ARCHITECTURE.md §4 allows forge -> shared in principle; every type
 * needed lives locally in types.ts.
 *
 * Wire shapes verified 2026-07-16 via WebFetch against docs.github.com
 * (apiVersion=2022-11-28) — see each chapter file's header / github-types.ts
 * for the specific pages cited. Contract tests pin every shape via recorded
 * fixtures (github-fixtures.ts), never a live call (docs/TESTING.md).
 */
import type {
  BranchProtectionDrift,
  BranchProtectionRules,
  CommitStatusInfo,
  CommitStatusInput,
  ForgeAdapter,
  ForgeCapabilities,
  ForgeIdentity,
  IssueComment,
  IssueInfo,
  IssueInput,
  IssueUpdate,
  MergePullRequestInput,
  MergeResult,
  PullRequestInfo,
  PullRequestInput,
  PullRequestState,
  RepoInfo,
  RepoRef,
} from './types.js';
import { createHttpFns, resolveToken } from './github-http.js';
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type GitHubAdapterConfig,
  type GitHubRuntime,
} from './github-types.js';
import { getRepo } from './github-repo.js';
import {
  checkBranchProtectionDrift,
  configureBranchProtection,
} from './github-protection.js';
import {
  closePullRequest,
  createPullRequest,
  getPullRequest,
  listPullRequests,
  mergePullRequest,
} from './github-pr.js';
import { commentOnIssue, createIssue, updateIssue } from './github-issues.js';
import { createCommitStatus } from './github-status.js';

export * from './github-types.js';

const GITHUB_CAPABILITIES: ForgeCapabilities = {
  prs: true,
  issues: true,
  protection: true,
  statuses: true,
};

export class GitHubForgeAdapter implements ForgeAdapter {
  readonly id: string;
  private readonly runtime: GitHubRuntime;

  constructor(config: GitHubAdapterConfig) {
    this.id = config.id ?? 'github';
    const now = config.now ?? Date.now;
    const { fetchRaw, throwHttpError } = createHttpFns(
      this.id,
      config.fetchImpl ?? fetch,
      now,
    );
    const runtime: GitHubRuntime = {
      id: this.id,
      apiBaseUrl: config.apiBaseUrl ?? GITHUB_API_BASE_URL,
      apiVersion: config.apiVersion ?? GITHUB_API_VERSION,
      makerToken: config.makerToken,
      reviewerToken: config.reviewerToken,
      now,
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      tokenFor: (identity: ForgeIdentity) => resolveToken(runtime, identity),
      fetchRaw,
      throwHttpError,
    };
    this.runtime = runtime;
  }

  capabilities(): ForgeCapabilities {
    return GITHUB_CAPABILITIES;
  }

  async getRepo(ref: RepoRef): Promise<RepoInfo> {
    return getRepo(this.runtime, ref);
  }

  async configureBranchProtection(
    ref: RepoRef,
    branch: string,
    rules: BranchProtectionRules,
  ): Promise<void> {
    return configureBranchProtection(this.runtime, ref, branch, rules);
  }

  async checkBranchProtectionDrift(
    ref: RepoRef,
    branch: string,
    expected: BranchProtectionRules,
  ): Promise<BranchProtectionDrift> {
    return checkBranchProtectionDrift(this.runtime, ref, branch, expected);
  }

  async createPullRequest(
    ref: RepoRef,
    input: PullRequestInput,
    identity?: ForgeIdentity,
  ): Promise<PullRequestInfo> {
    return createPullRequest(this.runtime, ref, input, identity);
  }

  async getPullRequest(ref: RepoRef, number: number): Promise<PullRequestInfo> {
    return getPullRequest(this.runtime, ref, number);
  }

  async listPullRequests(
    ref: RepoRef,
    state?: PullRequestState | 'all',
  ): Promise<PullRequestInfo[]> {
    return listPullRequests(this.runtime, ref, state);
  }

  async closePullRequest(
    ref: RepoRef,
    number: number,
    identity?: ForgeIdentity,
  ): Promise<PullRequestInfo> {
    return closePullRequest(this.runtime, ref, number, identity);
  }

  async mergePullRequest(
    ref: RepoRef,
    number: number,
    input: MergePullRequestInput,
    identity?: ForgeIdentity,
  ): Promise<MergeResult> {
    return mergePullRequest(this.runtime, ref, number, input, identity);
  }

  async createIssue(
    ref: RepoRef,
    input: IssueInput,
    identity?: ForgeIdentity,
  ): Promise<IssueInfo> {
    return createIssue(this.runtime, ref, input, identity);
  }

  async updateIssue(
    ref: RepoRef,
    number: number,
    update: IssueUpdate,
    identity?: ForgeIdentity,
  ): Promise<IssueInfo> {
    return updateIssue(this.runtime, ref, number, update, identity);
  }

  async commentOnIssue(
    ref: RepoRef,
    number: number,
    body: string,
    identity?: ForgeIdentity,
  ): Promise<IssueComment> {
    return commentOnIssue(this.runtime, ref, number, body, identity);
  }

  async createCommitStatus(
    ref: RepoRef,
    sha: string,
    input: CommitStatusInput,
    identity?: ForgeIdentity,
  ): Promise<CommitStatusInfo> {
    return createCommitStatus(this.runtime, ref, sha, input, identity);
  }
}

export function createGitHubForgeAdapter(
  config: GitHubAdapterConfig,
): GitHubForgeAdapter {
  return new GitHubForgeAdapter(config);
}
