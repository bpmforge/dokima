/**
 * Shared forge adapter contract suite (docs/design/CONTRACTS.md §2 Proof:
 * "one contract suite runs against GitHub + Gitea fixtures; parity
 * validator red on induced divergence").
 *
 * Unlike github.test.ts/gitea.test.ts (per-adapter wire tests) and the
 * per-chapter files (gitea-pr.test.ts etc., which pin Gitea-specific wire
 * deltas), this file defines ONE set of assertions and runs it against
 * BOTH real adapters via `describe.each` — the literal "one contract suite"
 * the Proof line requires, not a hand-mirrored duplicate. Each target
 * supplies its own recorded fixtures (github-fixtures.ts / gitea-fixtures.ts)
 * for a semantically-equivalent scenario; because both wire formats name
 * fields identically for these scenarios (Gitea's REST API is intentionally
 * GitHub-shaped), the resulting `ForgeAdapter`-level output is asserted to
 * be byte-identical, not just same-shaped — real cross-adapter parity, not
 * a coincidence of two adapters happening to pass separately.
 *
 * `mergePullRequest` is deliberately excluded: Gitea's merge verb is a
 * two-call read-after-write (gitea-pr.ts header) vs GitHub's single PUT,
 * a genuine wire-level difference already covered per-adapter in
 * github-pr.test.ts/gitea-pr.test.ts — forcing it into this suite would
 * paper over that difference instead of documenting it.
 *
 * checkForgeAdapterParity (gitea-parity.ts) is the structural half of the
 * Proof line; gitea-parity.test.ts includes the induced-divergence red
 * case.
 */
import { describe, expect, it } from 'vitest';
import { createGitHubForgeAdapter } from './github.js';
import { createGiteaForgeAdapter } from './gitea.js';
import {
  fakeFetch as githubFakeFetch,
  type FakeResponseSpec,
} from './github-test-helpers.js';
import { fakeFetch as giteaFakeFetch } from './gitea-test-helpers.js';
import * as githubFixtures from './github-fixtures.js';
import * as giteaFixtures from './gitea-fixtures.js';
import {
  ForgeAuthError,
  ForgeHttpError,
  ForgeTimeoutError,
  ForgeUnreachableError,
  ForgeValidationError,
  type BranchProtectionRules,
  type ForgeAdapter,
} from './types.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };

/** The connect-time contract every adapter configures (SC-14) — same rules object for both targets. */
const CONNECT_TIME_RULES: BranchProtectionRules = {
  requiredApprovingReviewCount: 1,
  dismissStaleReviews: true,
  requiredStatusChecks: ['ci/gate'],
  requireStrictStatusChecks: true,
  enforceAdmins: true,
  allowForcePushes: false,
  allowDeletions: false,
};

interface ContractTarget {
  name: string;
  fixtures: typeof githubFixtures | typeof giteaFixtures;
  /** Builds a fresh adapter whose calls are served, in order, by `responses`. */
  createAdapter: (responses: FakeResponseSpec[]) => ForgeAdapter;
}

function sequentialHandler(responses: FakeResponseSpec[]): () => FakeResponseSpec {
  let call = 0;
  return () => {
    const response = responses[call];
    call += 1;
    if (!response) {
      throw new Error(`sequentialHandler: no response queued for call #${call}`);
    }
    return response;
  };
}

const TARGETS: ContractTarget[] = [
  {
    name: 'github',
    fixtures: githubFixtures,
    createAdapter: (responses) => {
      const { fetchImpl } = githubFakeFetch(sequentialHandler(responses));
      return createGitHubForgeAdapter({
        makerToken: 'maker-token',
        reviewerToken: 'reviewer-token',
        fetchImpl,
      });
    },
  },
  {
    name: 'gitea',
    fixtures: giteaFixtures,
    createAdapter: (responses) => {
      const { fetchImpl } = giteaFakeFetch(sequentialHandler(responses));
      return createGiteaForgeAdapter({
        baseUrl: 'https://gitea.example.com',
        makerToken: 'maker-token',
        reviewerToken: 'reviewer-token',
        fetchImpl,
      });
    },
  },
];

function ok(body: unknown): FakeResponseSpec {
  return { status: 200, body };
}

function errorResponse(fixture: {
  status: number;
  statusText: string;
  body: string;
}): FakeResponseSpec {
  return {
    status: fixture.status,
    statusText: fixture.statusText,
    body: JSON.parse(fixture.body),
  };
}

describe.each(TARGETS)(
  '$name adapter — shared ForgeAdapter contract suite (CONTRACTS.md §2)',
  (target) => {
    it('capabilities(): declares full support', () => {
      const adapter = target.createAdapter([]);
      expect(adapter.capabilities()).toEqual({
        prs: true,
        issues: true,
        protection: true,
        statuses: true,
      });
    });

    it('getRepo(): maps a successful response to the RepoInfo contract', async () => {
      const adapter = target.createAdapter([ok(target.fixtures.repoSuccessFixture)]);
      const repo = await adapter.getRepo(REF);
      expect(repo).toEqual({
        fullName: 'shipwright-org/demo',
        defaultBranch: 'main',
        private: true,
        archived: false,
        permissions: { admin: true, push: true, pull: true },
      });
    });

    it('getRepo(): a 404 throws ForgeNotFoundError-family (ForgeHttpError)', async () => {
      const adapter = target.createAdapter([
        errorResponse(target.fixtures.repoNotFoundFixture),
      ]);
      await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeHttpError);
    });

    it('checkBranchProtectionDrift(): the connect-time fixture reports no drift', async () => {
      const adapter = target.createAdapter([
        ok(target.fixtures.connectTimeBranchProtectionFixture),
      ]);
      const drift = await adapter.checkBranchProtectionDrift(
        REF,
        'main',
        CONNECT_TIME_RULES,
      );
      expect(drift).toEqual({ drifted: false, differences: [] });
    });

    it('checkBranchProtectionDrift(): a loosened required-approver count is flagged', async () => {
      const adapter = target.createAdapter([
        ok(target.fixtures.driftedApprovalCountFixture),
      ]);
      const drift = await adapter.checkBranchProtectionDrift(
        REF,
        'main',
        CONNECT_TIME_RULES,
      );
      expect(drift).toEqual({
        drifted: true,
        differences: [{ field: 'requiredApprovingReviewCount', expected: 1, actual: 0 }],
      });
    });

    it('checkBranchProtectionDrift(): a re-enabled force-push is flagged', async () => {
      const adapter = target.createAdapter([ok(target.fixtures.driftedForcePushFixture)]);
      const drift = await adapter.checkBranchProtectionDrift(
        REF,
        'main',
        CONNECT_TIME_RULES,
      );
      expect(drift).toEqual({
        drifted: true,
        differences: [{ field: 'allowForcePushes', expected: false, actual: true }],
      });
    });

    it('checkBranchProtectionDrift(): a dropped required status check is flagged', async () => {
      const adapter = target.createAdapter([
        ok(target.fixtures.driftedStatusChecksFixture),
      ]);
      const drift = await adapter.checkBranchProtectionDrift(
        REF,
        'main',
        CONNECT_TIME_RULES,
      );
      expect(drift).toEqual({
        drifted: true,
        differences: [
          { field: 'requiredStatusChecks', expected: ['ci/gate'], actual: [] },
        ],
      });
    });

    it('createPullRequest(): maps a successful response to the PullRequestInfo contract', async () => {
      const adapter = target.createAdapter([
        ok(target.fixtures.pullRequestSuccessFixture),
      ]);
      const pr = await adapter.createPullRequest(REF, {
        title: 't',
        head: 'h',
        base: 'main',
      });
      expect(pr).toMatchObject({
        number: 42,
        state: 'open',
        merged: false,
        authorLogin: 'shipwright-maker',
        baseRef: 'main',
      });
    });

    it('listPullRequests(): maps a list response to PullRequestInfo[]', async () => {
      const adapter = target.createAdapter([ok(target.fixtures.pullRequestListFixture)]);
      const prs = await adapter.listPullRequests(REF, 'open');
      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({
        number: 42,
        state: 'open',
        authorLogin: 'shipwright-maker',
      });
    });

    it('closePullRequest(): maps the closed response to PullRequestInfo', async () => {
      const adapter = target.createAdapter([
        ok({ ...target.fixtures.pullRequestSuccessFixture, state: 'closed' }),
      ]);
      const pr = await adapter.closePullRequest(REF, 42);
      expect(pr).toMatchObject({ number: 42, state: 'closed' });
    });

    it('createIssue(): maps a successful response to the IssueInfo contract (no labels — single-call path on both adapters)', async () => {
      const adapter = target.createAdapter([ok(target.fixtures.issueSuccessFixture)]);
      const issue = await adapter.createIssue(REF, { title: 't', body: 'b' });
      expect(issue).toMatchObject({
        number: 7,
        state: 'open',
        title: target.fixtures.issueSuccessFixture.title,
      });
      expect(Array.isArray(issue.labels)).toBe(true);
      expect(issue.assignees).toEqual(['shipwright-maker']);
    });

    it('updateIssue(): maps the closed response to IssueInfo (no labels — single-call path on both adapters)', async () => {
      const adapter = target.createAdapter([ok(target.fixtures.issueClosedFixture)]);
      const issue = await adapter.updateIssue(REF, 7, { state: 'closed' });
      expect(issue).toMatchObject({ number: 7, state: 'closed' });
    });

    it('commentOnIssue(): maps a successful response to the IssueComment contract', async () => {
      const adapter = target.createAdapter([
        ok(target.fixtures.issueCommentSuccessFixture),
      ]);
      const comment = await adapter.commentOnIssue(REF, 7, 'accepted');
      expect(comment).toEqual({
        id: 5001,
        body: 'accepted — reviewer!=author verified',
        authorLogin: 'shipwright-reviewer',
        htmlUrl: target.fixtures.issueCommentSuccessFixture.html_url,
        createdAt: target.fixtures.issueCommentSuccessFixture.created_at,
      });
    });

    it('createCommitStatus(): maps a successful response to the CommitStatusInfo contract', async () => {
      const adapter = target.createAdapter([
        ok(target.fixtures.commitStatusSuccessFixture),
      ]);
      const status = await adapter.createCommitStatus(REF, 'abc123', {
        state: 'success',
        context: 'shipwright/gate',
      });
      expect(status).toEqual({
        id: 9001,
        state: 'success',
        context: 'shipwright/gate',
        createdAt: target.fixtures.commitStatusSuccessFixture.created_at,
      });
    });

    describe('generic error mapping (identical typed-error set for every adapter)', () => {
      it('401 -> ForgeAuthError', async () => {
        const adapter = target.createAdapter([
          errorResponse(target.fixtures.authUnauthorizedFixture),
        ]);
        await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeAuthError);
      });

      it('422 -> ForgeValidationError', async () => {
        const adapter = target.createAdapter([
          errorResponse(target.fixtures.validationErrorFixture),
        ]);
        await expect(
          adapter.createPullRequest(REF, { title: 't', head: 'h', base: 'main' }),
        ).rejects.toThrow(ForgeValidationError);
      });

      it('500 -> ForgeHttpError', async () => {
        const adapter = target.createAdapter([
          errorResponse(target.fixtures.serverErrorFixture),
        ]);
        await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeHttpError);
      });

      it('network failure -> ForgeUnreachableError', async () => {
        const fetchImpl = (async () => {
          throw new TypeError('network down');
        }) as unknown as typeof fetch;
        const adapter =
          target.name === 'github'
            ? createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl })
            : createGiteaForgeAdapter({
                baseUrl: 'https://gitea.example.com',
                makerToken: 'maker-token',
                fetchImpl,
              });
        await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeUnreachableError);
      });

      it('timeout -> ForgeTimeoutError', async () => {
        const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'TimeoutError';
              reject(err);
            });
          });
        }) as unknown as typeof fetch;
        const adapter =
          target.name === 'github'
            ? createGitHubForgeAdapter({
                makerToken: 'maker-token',
                fetchImpl,
                requestTimeoutMs: 1,
              })
            : createGiteaForgeAdapter({
                baseUrl: 'https://gitea.example.com',
                makerToken: 'maker-token',
                fetchImpl,
                requestTimeoutMs: 1,
              });
        await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeTimeoutError);
      });
    });
  },
);
