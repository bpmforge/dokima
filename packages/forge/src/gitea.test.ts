import { describe, expect, it } from 'vitest';
import { createGiteaForgeAdapter, GiteaForgeAdapter } from './gitea.js';
import {
  ForgeAuthError,
  ForgeHttpError,
  ForgeTimeoutError,
  ForgeUnreachableError,
  ForgeValidationError,
} from './types.js';
import { fakeFetch } from './gitea-test-helpers.js';
import {
  authUnauthorizedFixture,
  repoSuccessFixture,
  serverErrorFixture,
  validationErrorFixture,
} from './gitea-fixtures.js';

const REF = { owner: 'dokima-org', repo: 'demo' };
const BASE_URL = 'https://gitea.example.com';

describe('GiteaForgeAdapter — capabilities() (FR-I2)', () => {
  it('declares full support: prs, issues, protection, statuses — same contract shape as GitHub', () => {
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl: (() => {
        throw new Error('unused');
      }) as unknown as typeof fetch,
    });
    expect(adapter.capabilities()).toEqual({
      prs: true,
      issues: true,
      protection: true,
      statuses: true,
    });
  });
});

describe('GiteaForgeAdapter — generic error mapping (FR-I2)', () => {
  it('throws ForgeAuthError on 401', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: authUnauthorizedFixture.status,
      statusText: authUnauthorizedFixture.statusText,
      body: JSON.parse(authUnauthorizedFixture.body),
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'bad-token',
      fetchImpl,
    });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeAuthError);
  });

  it('throws ForgeValidationError on 422', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: validationErrorFixture.status,
      statusText: validationErrorFixture.statusText,
      body: JSON.parse(validationErrorFixture.body),
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(
      adapter.createPullRequest(REF, { title: 't', head: 'h', base: 'main' }),
    ).rejects.toThrow(ForgeValidationError);
  });

  it('throws ForgeHttpError on a plain 500', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: serverErrorFixture.status,
      statusText: serverErrorFixture.statusText,
      body: JSON.parse(serverErrorFixture.body),
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeHttpError);
  });

  it('throws ForgeUnreachableError when the network is down', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeUnreachableError);
  });

  it('throws ForgeTimeoutError when the request exceeds requestTimeoutMs', async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
      requestTimeoutMs: 1,
    });

    await expect(adapter.getRepo(REF)).rejects.toThrow(ForgeTimeoutError);
  });
});

describe('factory', () => {
  it('createGiteaForgeAdapter defaults id to "gitea"', () => {
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl: (() => {
        throw new Error('unused');
      }) as unknown as typeof fetch,
    });
    expect(adapter.id).toBe('gitea');
    expect(adapter).toBeInstanceOf(GiteaForgeAdapter);
  });

  it('honors a custom id (multi-project fleet, D-013)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: repoSuccessFixture }));
    const adapter = createGiteaForgeAdapter({
      id: 'gitea-project-b',
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });
    expect(adapter.id).toBe('gitea-project-b');
    await adapter.getRepo(REF);
  });
});
