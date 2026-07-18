import { describe, expect, it } from 'vitest';
import { createGiteaForgeAdapter } from './gitea.js';
import { ForgeHttpError, ForgeIdentityError, ForgeRateLimitError } from './types.js';
import { fakeFetch } from './gitea-test-helpers.js';
import {
  mergeNotMergeableFixture,
  mergeShaMismatchFixture,
  pullRequestListFixture,
  pullRequestMergedFixture,
  pullRequestSuccessFixture,
  secondaryRateLimitFixture,
} from './gitea-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };
const BASE_URL = 'https://gitea.example.com';

describe('GiteaForgeAdapter — PR lifecycle (FR-I2)', () => {
  it('createPullRequest() sends the maker token by default and parses the response', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: pullRequestSuccessFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const pr = await adapter.createPullRequest(REF, {
      title: 'feat(W6-02): Gitea adapter',
      head: 'sw/w6-02-gitea-adapter',
      base: 'main',
      body: 'ticket body',
    });

    expect(pr).toEqual({
      number: 42,
      state: 'open',
      title: 'feat(W6-02): Gitea adapter + generic git fallback',
      body: 'ticket body',
      htmlUrl: 'https://gitea.example.com/shipwright-org/demo/pulls/42',
      authorLogin: 'shipwright-maker',
      headRef: 'sw/w6-02-gitea-adapter',
      headSha: 'abc123def456',
      baseRef: 'main',
      merged: false,
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.authorization).toBe('token maker-token');
    expect(calls[0]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/pulls',
    );
  });

  it('listPullRequests() defaults to state=open and maps every entry', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: pullRequestListFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const prs = await adapter.listPullRequests(REF);
    expect(prs).toHaveLength(1);
    expect(prs[0]?.number).toBe(42);
    expect(calls[0]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/pulls?state=open',
    );
  });

  it('closePullRequest() PATCHes state=closed under the maker identity', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: { ...pullRequestSuccessFixture, state: 'closed' },
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const pr = await adapter.closePullRequest(REF, 42);
    expect(pr.state).toBe('closed');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ state: 'closed' });
    expect(calls[0]?.headers.authorization).toBe('token maker-token');
  });

  it('mergePullRequest() defaults to the reviewer identity and re-reads the PR for the empty-body merge response (SC-14)', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'POST') return { status: 200, body: undefined };
      return { status: 200, body: pullRequestMergedFixture };
    });
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      reviewerToken: 'reviewer-token',
      fetchImpl,
    });

    const result = await adapter.mergePullRequest(REF, 42, { mergeMethod: 'squash' });

    expect(result).toEqual({
      sha: 'deadbeefcafe',
      merged: true,
      message: 'Pull Request has been merged',
    });
    expect(calls[0]?.headers.authorization).toBe('token reviewer-token');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/pulls/42/merge',
    );
    expect(calls[0]?.body).toEqual({
      do: 'squash',
      merge_title_field: undefined,
      merge_message_field: undefined,
      head_commit_id: undefined,
    });
    expect(calls[1]?.method).toBe('GET');
    expect(calls[1]?.headers.authorization).toBe('token reviewer-token');
  });

  it('mergePullRequest() throws ForgeIdentityError when no reviewer token is configured (never silently substitutes maker)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: undefined }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

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
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
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
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
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

  it('throws ForgeRateLimitError with retryAfterMs on a 429 behind a reverse proxy', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: secondaryRateLimitFixture.status,
      statusText: secondaryRateLimitFixture.statusText,
      headers: secondaryRateLimitFixture.headers,
      body: JSON.parse(secondaryRateLimitFixture.body),
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const err = await adapter.listPullRequests(REF).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeRateLimitError);
    expect((err as ForgeRateLimitError).retryAfterMs).toBe(30_000);
  });
});
