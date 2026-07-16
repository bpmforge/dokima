/**
 * Forge adapter contract (docs/design/CONTRACTS.md §2, FR-I1/FR-I2): the
 * capability-declared surface every adapter (GitHub here; Gitea + generic-git
 * in W6-02) implements. Anything not listed here is a private adapter detail.
 *
 * No cross-package imports: packages/forge/package.json declares zero
 * dependencies (out of this ticket's write_scope to change), so this file
 * cannot import @shipwright/shared even though the ARCHITECTURE.md §4 import
 * matrix allows forge -> shared in principle — the workspace symlink only
 * exists once a package.json dependency is declared. Every shape needed here
 * (including the CredentialStore-like identity types) is defined locally,
 * same reasoning as packages/gateway/src/providers/copilot-types.ts's
 * CopilotCredentialStore.
 *
 * Credentials arrive pre-resolved (CONTRACTS §1's rule for the provider
 * adapter applies identically here): config carries plain token strings: no
 * adapter in this package touches a keychain.
 */

// ---- Capability declaration ----

export interface ForgeCapabilities {
  prs: boolean;
  issues: boolean;
  protection: boolean;
  statuses: boolean;
}

// ---- Identity / token management (FR-I1) ----

/**
 * Two scoped identities per SC-03/SC-14: `maker` for routine writes (repo
 * reads, PR/issue creation, commit statuses), `reviewer` for the operations
 * SC-14 reserves to a human or reviewer-policy identity (merging to main).
 * Only the caller that constructs the adapter ever holds both tokens — per
 * ARCHITECTURE.md law 5, that's harbormaster, never an agent session. This
 * package does not enforce that placement; it only refuses to silently
 * substitute one identity's token for the other's (see ForgeIdentityError).
 */
export type ForgeIdentity = 'maker' | 'reviewer';

export class ForgeIdentityError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly identity: ForgeIdentity,
  ) {
    super(
      `${adapterId}: operation requires the "${identity}" identity, but no ` +
        `${identity} credential was configured on this adapter instance`,
    );
    this.name = 'ForgeIdentityError';
  }
}

// ---- Errors (HTTP-shaped; adapter-agnostic so Gitea/generic can reuse) ----

export class ForgeHttpError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`${adapterId}: request failed with ${status} ${statusText}`);
    this.name = 'ForgeHttpError';
  }
}

export class ForgeAuthError extends ForgeHttpError {
  constructor(adapterId: string, status: number, statusText: string, body: string) {
    super(adapterId, status, statusText, body);
    this.name = 'ForgeAuthError';
  }
}

export class ForgeNotFoundError extends ForgeHttpError {
  constructor(adapterId: string, status: number, statusText: string, body: string) {
    super(adapterId, status, statusText, body);
    this.name = 'ForgeNotFoundError';
  }
}

export class ForgeValidationError extends ForgeHttpError {
  constructor(adapterId: string, status: number, statusText: string, body: string) {
    super(adapterId, status, statusText, body);
    this.name = 'ForgeValidationError';
  }
}

export class ForgeRateLimitError extends ForgeHttpError {
  constructor(
    adapterId: string,
    status: number,
    statusText: string,
    body: string,
    public readonly retryAfterMs?: number,
  ) {
    super(adapterId, status, statusText, body);
    this.name = 'ForgeRateLimitError';
  }
}

export class ForgeTimeoutError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly timeoutMs: number,
  ) {
    super(`${adapterId}: request timed out after ${timeoutMs}ms`);
    this.name = 'ForgeTimeoutError';
  }
}

export class ForgeUnreachableError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly cause: unknown,
  ) {
    super(`${adapterId}: endpoint unreachable — ${String(cause)}`);
    this.name = 'ForgeUnreachableError';
  }
}

/** Response reached us at 2xx but did not carry the fields the contract requires. */
export class ForgeResponseShapeError extends Error {
  constructor(adapterId: string, detail: string) {
    super(`${adapterId}: unexpected response shape — ${detail}`);
    this.name = 'ForgeResponseShapeError';
  }
}

// ---- Repo ops ----

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  permissions: { admin: boolean; push: boolean; pull: boolean };
}

// ---- Branch protection (SC-14) ----

/**
 * The connect-time contract SC-14 requires: reviewer != author (via a
 * required approving review count >= 1), no force-push (fixed at the type
 * level — `allowForcePushes` only accepts `false`, so a caller cannot even
 * construct a rule set that would weaken it), and required status checks.
 */
export interface BranchProtectionRules {
  requiredApprovingReviewCount: number;
  dismissStaleReviews: boolean;
  requiredStatusChecks: string[];
  requireStrictStatusChecks: boolean;
  enforceAdmins: boolean;
  allowForcePushes: false;
  allowDeletions: boolean;
}

/** What re-reading the forge's live protection settings actually returns. */
export interface BranchProtectionSnapshot {
  requiredApprovingReviewCount: number;
  dismissStaleReviews: boolean;
  requiredStatusChecks: string[];
  requireStrictStatusChecks: boolean;
  enforceAdmins: boolean;
  allowForcePushes: boolean;
  allowDeletions: boolean;
}

export interface BranchProtectionDifference {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface BranchProtectionDrift {
  drifted: boolean;
  differences: BranchProtectionDifference[];
}

// ---- PR lifecycle ----

export type PullRequestState = 'open' | 'closed';

export interface PullRequestInput {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}

export interface PullRequestInfo {
  number: number;
  state: PullRequestState;
  title: string;
  body: string | null;
  htmlUrl: string;
  authorLogin: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  merged: boolean;
}

export interface MergePullRequestInput {
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
  /** Required head SHA — refuses the merge if the PR moved underneath the caller. */
  sha?: string;
}

export interface MergeResult {
  sha: string;
  merged: boolean;
  message: string;
}

// ---- Issue mirror ----

export type IssueState = 'open' | 'closed';
export type IssueStateReason = 'completed' | 'not_planned' | 'reopened';

export interface IssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface IssueUpdate {
  state?: IssueState;
  stateReason?: IssueStateReason;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface IssueInfo {
  number: number;
  state: IssueState;
  stateReason: IssueStateReason | null;
  title: string;
  body: string | null;
  htmlUrl: string;
  labels: string[];
  assignees: string[];
}

export interface IssueComment {
  id: number;
  body: string;
  authorLogin: string;
  htmlUrl: string;
  createdAt: string;
}

// ---- Commit status ----

export type CommitStatusState = 'pending' | 'success' | 'error' | 'failure';

export interface CommitStatusInput {
  state: CommitStatusState;
  context: string;
  description?: string;
  targetUrl?: string;
}

export interface CommitStatusInfo {
  id: number;
  state: CommitStatusState;
  context: string;
  createdAt: string;
}

// ---- The adapter contract ----

export interface ForgeAdapter {
  readonly id: string;

  capabilities(): ForgeCapabilities;

  getRepo(ref: RepoRef): Promise<RepoInfo>;

  configureBranchProtection(
    ref: RepoRef,
    branch: string,
    rules: BranchProtectionRules,
  ): Promise<void>;

  /** SC-14: re-reads live settings and flags drift from the connect-time contract. */
  checkBranchProtectionDrift(
    ref: RepoRef,
    branch: string,
    expected: BranchProtectionRules,
  ): Promise<BranchProtectionDrift>;

  createPullRequest(
    ref: RepoRef,
    input: PullRequestInput,
    identity?: ForgeIdentity,
  ): Promise<PullRequestInfo>;

  getPullRequest(ref: RepoRef, number: number): Promise<PullRequestInfo>;

  listPullRequests(
    ref: RepoRef,
    state?: PullRequestState | 'all',
  ): Promise<PullRequestInfo[]>;

  closePullRequest(
    ref: RepoRef,
    number: number,
    identity?: ForgeIdentity,
  ): Promise<PullRequestInfo>;

  /** Merge rights on main are reviewer/human-held (SC-14) — defaults to the reviewer identity. */
  mergePullRequest(
    ref: RepoRef,
    number: number,
    input: MergePullRequestInput,
    identity?: ForgeIdentity,
  ): Promise<MergeResult>;

  createIssue(
    ref: RepoRef,
    input: IssueInput,
    identity?: ForgeIdentity,
  ): Promise<IssueInfo>;

  updateIssue(
    ref: RepoRef,
    number: number,
    update: IssueUpdate,
    identity?: ForgeIdentity,
  ): Promise<IssueInfo>;

  commentOnIssue(
    ref: RepoRef,
    number: number,
    body: string,
    identity?: ForgeIdentity,
  ): Promise<IssueComment>;

  createCommitStatus(
    ref: RepoRef,
    sha: string,
    input: CommitStatusInput,
    identity?: ForgeIdentity,
  ): Promise<CommitStatusInfo>;
}
