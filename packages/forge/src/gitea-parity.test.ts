import { describe, expect, it } from 'vitest';
import { checkForgeAdapterParity, type ParityCheckedAdapter } from './gitea-parity.js';
import { createGitHubForgeAdapter } from './github.js';
import { createGiteaForgeAdapter } from './gitea.js';
import { fakeFetch as githubFakeFetch } from './github-test-helpers.js';
import { fakeFetch as giteaFakeFetch } from './gitea-test-helpers.js';
import { repoSuccessFixture as githubRepoFixture } from './github-fixtures.js';
import { repoSuccessFixture as giteaRepoFixture } from './gitea-fixtures.js';
import type { ForgeAdapter } from './types.js';

const REF = { owner: 'dokima-org', repo: 'demo' };

function realAdapters(): { github: ForgeAdapter; gitea: ForgeAdapter } {
  const { fetchImpl: githubFetch } = githubFakeFetch(() => ({
    status: 200,
    body: githubRepoFixture,
  }));
  const { fetchImpl: giteaFetch } = giteaFakeFetch(() => ({
    status: 200,
    body: giteaRepoFixture,
  }));
  return {
    github: createGitHubForgeAdapter({
      makerToken: 'maker-token',
      fetchImpl: githubFetch,
    }),
    gitea: createGiteaForgeAdapter({
      baseUrl: 'https://gitea.example.com',
      makerToken: 'maker-token',
      fetchImpl: giteaFetch,
    }),
  };
}

describe('checkForgeAdapterParity (CONTRACTS.md §2 Proof: parity validator)', () => {
  it('is clean (diverged: false) between the real GitHub and Gitea adapters', async () => {
    const { github, gitea } = realAdapters();
    const result = await checkForgeAdapterParity(github, gitea, REF);
    expect(result).toEqual({ diverged: false, differences: [] });
  });

  it('goes red on induced divergence: a chapter that drops a contract field', async () => {
    const { github, gitea } = realAdapters();
    // Plant the exact defect the Proof line guards against: an adapter
    // whose getRepo() silently drops a field the ForgeAdapter contract
    // promises (RepoInfo.archived), rather than a hypothetical bug.
    const brokenGitea: ParityCheckedAdapter = {
      capabilities: () => gitea.capabilities(),
      async getRepo(ref) {
        const info = await gitea.getRepo(ref);
        return {
          fullName: info.fullName,
          defaultBranch: info.defaultBranch,
          private: info.private,
          permissions: info.permissions,
        } as typeof info;
      },
    };

    const result = await checkForgeAdapterParity(github, brokenGitea, REF);

    expect(result.diverged).toBe(true);
    expect(result.differences).toContainEqual({
      operation: 'getRepo',
      onlyInA: ['archived'],
      onlyInB: [],
    });
  });

  it('goes red on induced divergence: a chapter that renames a contract field', async () => {
    const { github, gitea } = realAdapters();
    const brokenGitea: ParityCheckedAdapter = {
      capabilities() {
        const caps = gitea.capabilities();
        const { statuses, ...rest } = caps;
        return { ...rest, commitStatuses: statuses } as unknown as ReturnType<
          ForgeAdapter['capabilities']
        >;
      },
      getRepo: (ref) => gitea.getRepo(ref),
    };

    const result = await checkForgeAdapterParity(github, brokenGitea, REF);

    expect(result.diverged).toBe(true);
    const capabilitiesDiff = result.differences.find(
      (d) => d.operation === 'capabilities',
    );
    expect(capabilitiesDiff).toEqual({
      operation: 'capabilities',
      onlyInA: ['statuses'],
      onlyInB: ['commitStatuses'],
    });
  });
});
