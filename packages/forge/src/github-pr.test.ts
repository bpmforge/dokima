import { describe, expect, it } from 'vitest';
import { createGitHubForgeAdapter } from './github.js';
import { ForgeHttpError, ForgeIdentityError, ForgeRateLimitError } from './types.js';
import { fakeFetch } from './github-test-helpers.js';
import {
  mergeNotMergeableFixture,
  mergeShaMismatchFixture,
  mergeSuccessFixture,
  pullRequestListFixture,
  pullRequestSuccessFixture,
  secondaryRateLimitFixture,
} from './github-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };

describe('GitHubForgeAdapter — PR lifecycle', () => {
  it('createPullRequest() sends the maker bearer by default and parses the response', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: pullRequestSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const pr = await adapter.createPullRequest(REF, {
      title: 'feat(W6-01): forge framework',
      head: 'sw/w6-01-github-adapter',
      base: 'main',
      body: 'ticket body',
    });

    expect(pr).toEqual({
      number: 42,
      state: 'open',
      title: 'feat(W6-01): forge framework + GitHub adapter',
      body: 'ticket body',
      htmlUrl: 'https://github.com/shipwright-org/demo/pull/42',
      authorLogin: 'shipwright-maker',
      headRef: 'sw/w6-01-github-adapter',
      headSha: 'abc123def456',
      baseRef: 'main',
      merged: false,
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.authorization).toBe('Bearer maker-token');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/shipwright-org/demo/pulls');
  });

  it('listPullRequests() defaults to state=open and maps every entry', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: pullRequestListFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const prs = await adapter.listPullRequests(REF);
    expect(prs).toHaveLength(1);
    expect(prs[0]?.number).toBe(42);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/shipwright-org/demo/pulls?state=open',
    );
  });

  it('closePullRequest() PATCHes state=closed under the maker identity', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: { ...pullRequestSuccessFixture, state: 'closed' },
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const pr = await adapter.closePullRequest(REF, 42);
    expect(pr.state).toBe('closed');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ state: 'closed' });
    expect(calls[0]?.headers.authorization).toBe('Bearer maker-token');
  });

  it('mergePullRequest() defaults to the reviewer identity (SC-14: merge rights are reviewer/human-held)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: mergeSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({
      makerToken: 'maker-token',
      reviewerToken: 'reviewer-token',
      fetchImpl,
    });

    const result = await adapter.mergePullRequest(REF, 42, { mergeMethod: 'squash' });

    expect(result).toEqual(mergeSuccessFixture);
    expect(calls[0]?.headers.authorization).toBe('Bearer reviewer-token');
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/shipwright-org/demo/pulls/42/merge',
    );
  });

  it('mergePullRequest() throws ForgeIdentityError when no reviewer token is configured (never silently substitutes maker)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: mergeSuccessFixture }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    await expect(adapter.mergePullRequest(REF, 42, {})).rejects.toThrow(
      ForgeIdentityError,
    );
  });

  it('mergePullRequest() surfaces a 405 (not mergeable) as ForgeHttpError with the status preserved', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: mergeNotMergeableFixture.status,
      statusText: mergeNotMergeableFixture.statusText,
      body: JSON.parse(mergeNotMergeableFixture.body),
    }));
    const adapter = createGitHubForgeAdapter({
      makerToken: 'maker-token',
      reviewerToken: 'reviewer-token',
      fetchImpl,
    });

    const err = await adapter.mergePullRequest(REF, 42, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(405);
  });

  it('mergePullRequest() surfaces a 409 (sha mismatch) as ForgeHttpError with the status preserved', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: mergeShaMismatchFixture.status,
      statusText: mergeShaMismatchFixture.statusText,
      body: JSON.parse(mergeShaMismatchFixture.body),
    }));
    const adapter = createGitHubForgeAdapter({
      makerToken: 'maker-token',
      reviewerToken: 'reviewer-token',
      fetchImpl,
    });

    const err = await adapter
      .mergePullRequest(REF, 42, { sha: 'stale-sha' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(409);
  });

  it('throws ForgeRateLimitError with retryAfterMs on a secondary rate-limit 429', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: secondaryRateLimitFixture.status,
      statusText: secondaryRateLimitFixture.statusText,
      headers: secondaryRateLimitFixture.headers,
      body: JSON.parse(secondaryRateLimitFixture.body),
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const err = await adapter.listPullRequests(REF).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeRateLimitError);
    expect((err as ForgeRateLimitError).retryAfterMs).toBe(30_000);
  });
});
