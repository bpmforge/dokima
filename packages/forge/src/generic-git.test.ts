import { describe, expect, it } from 'vitest';
import {
  createGenericGitForgeAdapter,
  GenericGitForgeAdapter,
  GenericGitUnsupportedError,
} from './generic-git.js';

const REF = { owner: 'dokima-org', repo: 'demo' };

describe('GenericGitForgeAdapter — capabilities() (FR-I2: honest degradation)', () => {
  it('declares no forge support at all: prs, issues, protection, statuses all false', () => {
    const adapter = createGenericGitForgeAdapter();
    expect(adapter.capabilities()).toEqual({
      prs: false,
      issues: false,
      protection: false,
      statuses: false,
    });
  });
});

describe('GenericGitForgeAdapter — every operation fails loudly instead of no-op degrading (D-014)', () => {
  it('getRepo() rejects — there is no bare-SSH-git equivalent for private/archived/permissions', async () => {
    const adapter = createGenericGitForgeAdapter();
    const err = await adapter.getRepo(REF).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenericGitUnsupportedError);
    expect((err as GenericGitUnsupportedError).operation).toBe('getRepo');
  });

  it('configureBranchProtection() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(
      adapter.configureBranchProtection(REF, 'main', {
        requiredApprovingReviewCount: 1,
        dismissStaleReviews: true,
        requiredStatusChecks: [],
        requireStrictStatusChecks: false,
        enforceAdmins: true,
        allowForcePushes: false,
        allowDeletions: false,
      }),
    ).rejects.toThrow(GenericGitUnsupportedError);
  });

  it('checkBranchProtectionDrift() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(
      adapter.checkBranchProtectionDrift(REF, 'main', {
        requiredApprovingReviewCount: 1,
        dismissStaleReviews: true,
        requiredStatusChecks: [],
        requireStrictStatusChecks: false,
        enforceAdmins: true,
        allowForcePushes: false,
        allowDeletions: false,
      }),
    ).rejects.toThrow(GenericGitUnsupportedError);
  });

  it("createPullRequest() rejects — no PRs without a forge (local merge path is the caller's job)", async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(
      adapter.createPullRequest(REF, { title: 't', head: 'h', base: 'main' }),
    ).rejects.toThrow(GenericGitUnsupportedError);
  });

  it('getPullRequest() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.getPullRequest(REF, 1)).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('listPullRequests() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.listPullRequests(REF)).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('closePullRequest() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.closePullRequest(REF, 1)).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('mergePullRequest() rejects — degrading to a local merge happens outside this adapter', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.mergePullRequest(REF, 1, {})).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('createIssue() rejects — no issue mirror without a forge', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.createIssue(REF, { title: 't' })).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('updateIssue() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.updateIssue(REF, 1, { state: 'closed' })).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('commentOnIssue() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(adapter.commentOnIssue(REF, 1, 'body')).rejects.toThrow(
      GenericGitUnsupportedError,
    );
  });

  it('createCommitStatus() rejects', async () => {
    const adapter = createGenericGitForgeAdapter();
    await expect(
      adapter.createCommitStatus(REF, 'sha', { state: 'success', context: 'ctx' }),
    ).rejects.toThrow(GenericGitUnsupportedError);
  });
});

describe('factory', () => {
  it('createGenericGitForgeAdapter defaults id to "generic-git"', () => {
    const adapter = createGenericGitForgeAdapter();
    expect(adapter.id).toBe('generic-git');
    expect(adapter).toBeInstanceOf(GenericGitForgeAdapter);
  });

  it('honors a custom id (multi-project fleet, D-013) and includes it in the error message', async () => {
    const adapter = createGenericGitForgeAdapter({ id: 'generic-git-project-b' });
    expect(adapter.id).toBe('generic-git-project-b');
    const err = await adapter.getRepo(REF).catch((e: unknown) => e);
    expect((err as Error).message).toContain('generic-git-project-b');
  });
});
