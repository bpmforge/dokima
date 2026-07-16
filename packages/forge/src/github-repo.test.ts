import { describe, expect, it } from 'vitest';
import { createGitHubForgeAdapter } from './github.js';
import { ForgeNotFoundError, ForgeResponseShapeError } from './types.js';
import { fakeFetch } from './github-test-helpers.js';
import {
  repoMissingPermissionsFixture,
  repoNotFoundFixture,
  repoSuccessFixture,
} from './github-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };

describe('GitHubForgeAdapter — getRepo()', () => {
  it('parses a repo response and sends the maker bearer + required headers', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: repoSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const repo = await adapter.getRepo(REF);

    expect(repo).toEqual({
      fullName: 'shipwright-org/demo',
      defaultBranch: 'main',
      private: true,
      archived: false,
      permissions: { admin: true, push: true, pull: true },
    });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/shipwright-org/demo');
    expect(calls[0]?.headers.authorization).toBe('Bearer maker-token');
    expect(calls[0]?.headers.accept).toBe('application/vnd.github+json');
    expect(calls[0]?.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('throws ForgeResponseShapeError when permissions is missing from a 200 body', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: repoMissingPermissionsFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeResponseShapeError);
  });

  it('throws ForgeNotFoundError on 404', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: repoNotFoundFixture.status,
      statusText: repoNotFoundFixture.statusText,
      body: JSON.parse(repoNotFoundFixture.body),
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeNotFoundError);
  });
});
