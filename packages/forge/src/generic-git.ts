/**
 * Generic self-hosted git adapter (FR-I2, W6-02): the honest-degradation
 * fallback for a repo reachable only over plain SSH git, with no forge REST
 * API behind it. Per docs/design/CONTRACTS.md §2 ("generic-git returns all
 * false and degrades to local merge"):
 *
 * - `capabilities()` truthfully reports `{ prs: false, issues: false,
 *   protection: false, statuses: false }` — never a partial or fabricated
 *   "yes".
 * - Every operation this adapter cannot perform — which is all of them,
 *   including `getRepo()` (RepoInfo's `private`/`archived`/`permissions`
 *   fields have no bare-SSH-git equivalent to read) — rejects loudly with
 *   `GenericGitUnsupportedError` rather than silently no-op'ing or
 *   inventing a plausible-looking value (D-014: never silent).
 *
 * The actual "local merge path" this degrades to is deliberately NOT
 * implemented here: it's `packages/git`'s `mergeLocal()` (BLUEPRINT §3.9),
 * invoked directly by the caller (a future landing/harbormaster ticket)
 * once it observes `capabilities().prs === false` — never through this
 * adapter. packages/forge/package.json declares zero dependencies, and
 * ARCHITECTURE.md §4 only permits forge -> git once that dependency is
 * added (out of this ticket's write_scope); routing the merge itself
 * through this adapter would require that addition, which is a HANDOFF,
 * not a workaround.
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

export class GenericGitUnsupportedError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly operation: string,
  ) {
    super(
      `${adapterId}: "${operation}" is not supported — generic self-hosted git has no ` +
        `forge REST API (FR-I2); check capabilities() and route to packages/git's local ` +
        `merge/landing path instead of calling this adapter for this operation`,
    );
    this.name = 'GenericGitUnsupportedError';
  }
}

export interface GenericGitAdapterConfig {
  id?: string;
}

const GENERIC_GIT_CAPABILITIES: ForgeCapabilities = {
  prs: false,
  issues: false,
  protection: false,
  statuses: false,
};

export class GenericGitForgeAdapter implements ForgeAdapter {
  readonly id: string;

  constructor(config: GenericGitAdapterConfig = {}) {
    this.id = config.id ?? 'generic-git';
  }

  private unsupported(operation: string): never {
    throw new GenericGitUnsupportedError(this.id, operation);
  }

  capabilities(): ForgeCapabilities {
    return GENERIC_GIT_CAPABILITIES;
  }

  async getRepo(_ref: RepoRef): Promise<RepoInfo> {
    return this.unsupported('getRepo');
  }

  async configureBranchProtection(
    _ref: RepoRef,
    _branch: string,
    _rules: BranchProtectionRules,
  ): Promise<void> {
    return this.unsupported('configureBranchProtection');
  }

  async checkBranchProtectionDrift(
    _ref: RepoRef,
    _branch: string,
    _expected: BranchProtectionRules,
  ): Promise<BranchProtectionDrift> {
    return this.unsupported('checkBranchProtectionDrift');
  }

  async createPullRequest(
    _ref: RepoRef,
    _input: PullRequestInput,
    _identity?: ForgeIdentity,
  ): Promise<PullRequestInfo> {
    return this.unsupported('createPullRequest');
  }

  async getPullRequest(_ref: RepoRef, _number: number): Promise<PullRequestInfo> {
    return this.unsupported('getPullRequest');
  }

  async listPullRequests(
    _ref: RepoRef,
    _state?: PullRequestState | 'all',
  ): Promise<PullRequestInfo[]> {
    return this.unsupported('listPullRequests');
  }

  async closePullRequest(
    _ref: RepoRef,
    _number: number,
    _identity?: ForgeIdentity,
  ): Promise<PullRequestInfo> {
    return this.unsupported('closePullRequest');
  }

  async mergePullRequest(
    _ref: RepoRef,
    _number: number,
    _input: MergePullRequestInput,
    _identity?: ForgeIdentity,
  ): Promise<MergeResult> {
    return this.unsupported('mergePullRequest');
  }

  async createIssue(
    _ref: RepoRef,
    _input: IssueInput,
    _identity?: ForgeIdentity,
  ): Promise<IssueInfo> {
    return this.unsupported('createIssue');
  }

  async updateIssue(
    _ref: RepoRef,
    _number: number,
    _update: IssueUpdate,
    _identity?: ForgeIdentity,
  ): Promise<IssueInfo> {
    return this.unsupported('updateIssue');
  }

  async commentOnIssue(
    _ref: RepoRef,
    _number: number,
    _body: string,
    _identity?: ForgeIdentity,
  ): Promise<IssueComment> {
    return this.unsupported('commentOnIssue');
  }

  async createCommitStatus(
    _ref: RepoRef,
    _sha: string,
    _input: CommitStatusInput,
    _identity?: ForgeIdentity,
  ): Promise<CommitStatusInfo> {
    return this.unsupported('createCommitStatus');
  }
}

export function createGenericGitForgeAdapter(
  config?: GenericGitAdapterConfig,
): GenericGitForgeAdapter {
  return new GenericGitForgeAdapter(config);
}
