/**
 * Gitea forge adapter (FR-I2, W6-02): repo ops, branch protection + drift
 * validator (SC-14), PR lifecycle, issue mirror primitives, commit status,
 * identity/token management — the same `ForgeAdapter` contract github.ts
 * implements (types.ts, docs/design/CONTRACTS.md §2), verified against the
 * live Gitea OpenAPI spec (gitea-types.ts header) rather than assumed
 * GitHub-shaped.
 *
 * Same book-style split as github.ts: gitea-types.ts (wire shapes + config
 * + runtime context), gitea-http.ts (fetch/timeout plumbing + status->error
 * mapping), gitea-repo.ts, gitea-protection.ts, gitea-pr.ts,
 * gitea-issues.ts, gitea-status.ts (one chapter per contract area). This
 * file is the barrel: GiteaForgeAdapter implements ForgeAdapter and is the
 * only place that owns per-instance state (the runtime context, its
 * tokens).
 *
 * Two scoped identities (FR-I2, SC-03/SC-14): `maker` for routine writes,
 * `reviewer` for merges — identical model to the GitHub adapter. Tokens
 * arrive pre-resolved in config; this adapter never touches a keychain.
 * packages/forge/package.json declares no dependencies (out of this
 * ticket's write_scope to add one), so every type this file needs lives
 * locally (types.ts, gitea-types.ts), same reasoning as github.ts's header.
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
import { createHttpFns, resolveToken } from './gitea-http.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type GiteaAdapterConfig,
  type GiteaRuntime,
} from './gitea-types.js';
import { getRepo } from './gitea-repo.js';
import {
  checkBranchProtectionDrift,
  configureBranchProtection,
} from './gitea-protection.js';
import {
  closePullRequest,
  createPullRequest,
  getPullRequest,
  listPullRequests,
  mergePullRequest,
} from './gitea-pr.js';
import { commentOnIssue, createIssue, updateIssue } from './gitea-issues.js';
import { createCommitStatus } from './gitea-status.js';

export * from './gitea-types.js';

const GITEA_CAPABILITIES: ForgeCapabilities = {
  prs: true,
  issues: true,
  protection: true,
  statuses: true,
};

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class GiteaForgeAdapter implements ForgeAdapter {
  readonly id: string;
  private readonly runtime: GiteaRuntime;

  constructor(config: GiteaAdapterConfig) {
    this.id = config.id ?? 'gitea';
    const now = config.now ?? Date.now;
    const { fetchRaw, throwHttpError } = createHttpFns(
      this.id,
      config.fetchImpl ?? fetch,
      now,
    );
    const runtime: GiteaRuntime = {
      id: this.id,
      apiBaseUrl: `${trimTrailingSlash(config.baseUrl)}/api/v1`,
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
    return GITEA_CAPABILITIES;
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

export function createGiteaForgeAdapter(config: GiteaAdapterConfig): GiteaForgeAdapter {
  return new GiteaForgeAdapter(config);
}
