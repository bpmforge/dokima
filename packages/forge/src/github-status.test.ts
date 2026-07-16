import { describe, expect, it } from 'vitest';
import { createGitHubForgeAdapter } from './github.js';
import { fakeFetch } from './github-test-helpers.js';
import { commitStatusSuccessFixture } from './github-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };

describe('GitHubForgeAdapter — createCommitStatus()', () => {
  it('POSTs to /statuses/{sha} and parses the response', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: commitStatusSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const status = await adapter.createCommitStatus(REF, 'abc123def456', {
      state: 'success',
      context: 'shipwright/gate',
      description: 'gate green',
    });

    expect(status).toEqual({
      id: 9001,
      state: 'success',
      context: 'shipwright/gate',
      createdAt: '2026-07-16T12:05:00Z',
    });
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/shipwright-org/demo/statuses/abc123def456',
    );
    expect(calls[0]?.body).toEqual({
      state: 'success',
      context: 'shipwright/gate',
      description: 'gate green',
      target_url: undefined,
    });
  });
});
