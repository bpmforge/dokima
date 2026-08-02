import { describe, expect, it } from 'vitest';
import { createGiteaForgeAdapter } from './gitea.js';
import { ForgeNotFoundError, ForgeResponseShapeError } from './types.js';
import { fakeFetch } from './gitea-test-helpers.js';
import {
  repoMissingPermissionsFixture,
  repoNotFoundFixture,
  repoSuccessFixture,
} from './gitea-fixtures.js';

const REF = { owner: 'dokima-org', repo: 'demo' };
const BASE_URL = 'https://gitea.example.com';

describe('GiteaForgeAdapter — getRepo() (FR-I2)', () => {
  it('parses a repo response and sends the maker token + required headers', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: repoSuccessFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const repo = await adapter.getRepo(REF);

    expect(repo).toEqual({
      fullName: 'dokima-org/demo',
      defaultBranch: 'main',
      private: true,
      archived: false,
      permissions: { admin: true, push: true, pull: true },
    });
    expect(calls[0]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/dokima-org/demo',
    );
    expect(calls[0]?.headers.authorization).toBe('token maker-token');
    expect(calls[0]?.headers.accept).toBe('application/json');
  });

  it('trims a trailing slash on baseUrl before appending /api/v1', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: repoSuccessFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: `${BASE_URL}/`,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await adapter.getRepo(REF);
    expect(calls[0]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/dokima-org/demo',
    );
  });

  it('throws ForgeResponseShapeError when permissions is missing from a 200 body', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: repoMissingPermissionsFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeResponseShapeError);
  });

  it('throws ForgeNotFoundError on 404', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: repoNotFoundFixture.status,
      statusText: repoNotFoundFixture.statusText,
      body: JSON.parse(repoNotFoundFixture.body),
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeNotFoundError);
  });
});
