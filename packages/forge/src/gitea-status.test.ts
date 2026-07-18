import { describe, expect, it } from 'vitest';
import { createGiteaForgeAdapter } from './gitea.js';
import { ForgeResponseShapeError } from './types.js';
import { fakeFetch } from './gitea-test-helpers.js';
import { commitStatusSuccessFixture } from './gitea-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };
const BASE_URL = 'https://gitea.example.com';

describe('GiteaForgeAdapter — createCommitStatus() (FR-I2)', () => {
  it('posts under the maker identity and maps the "status" wire field to "state"', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: commitStatusSuccessFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const status = await adapter.createCommitStatus(REF, 'abc123', {
      state: 'success',
      context: 'shipwright/gate',
    });

    expect(status).toEqual({
      id: 9001,
      state: 'success',
      context: 'shipwright/gate',
      createdAt: '2026-07-18T12:05:00Z',
    });
    expect(calls[0]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/statuses/abc123',
    );
    expect(calls[0]?.body).toEqual({
      state: 'success',
      context: 'shipwright/gate',
      description: undefined,
      target_url: undefined,
    });
  });

  it('throws ForgeResponseShapeError on a status value outside this adapter contract\'s enum (e.g. "warning")', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 201,
      body: { ...commitStatusSuccessFixture, status: 'warning' },
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(
      adapter.createCommitStatus(REF, 'abc123', {
        state: 'success',
        context: 'shipwright/gate',
      }),
    ).rejects.toThrow(ForgeResponseShapeError);
  });
});
