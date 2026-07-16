import { describe, expect, it } from 'vitest';
import { createGitHubForgeAdapter } from './github.js';
import { ForgeAuthError, type BranchProtectionRules } from './types.js';
import { fakeFetch } from './github-test-helpers.js';
import {
  branchProtectionForbiddenFixture,
  connectTimeBranchProtectionFixture,
  driftedApprovalCountFixture,
  driftedForcePushFixture,
  driftedStatusChecksFixture,
} from './github-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };

/** The connect-time contract SC-14 requires: reviewer!=author, no force-push, required checks. */
const CONNECT_CONTRACT: BranchProtectionRules = {
  requiredApprovingReviewCount: 1,
  dismissStaleReviews: true,
  requiredStatusChecks: ['ci/gate'],
  requireStrictStatusChecks: true,
  enforceAdmins: true,
  allowForcePushes: false,
  allowDeletions: false,
};

describe('GitHubForgeAdapter — configureBranchProtection()', () => {
  it('PUTs the SC-14 contract: required approvals, no force-push, required checks', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: connectTimeBranchProtectionFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    await adapter.configureBranchProtection(REF, 'main', CONNECT_CONTRACT);

    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/shipwright-org/demo/branches/main/protection',
    );
    expect(calls[0]?.body).toEqual({
      required_status_checks: { strict: true, contexts: ['ci/gate'] },
      enforce_admins: true,
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
      },
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    });
  });

  it('throws ForgeAuthError when the caller lacks admin rights (HP-6)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: branchProtectionForbiddenFixture.status,
      statusText: branchProtectionForbiddenFixture.statusText,
      body: JSON.parse(branchProtectionForbiddenFixture.body),
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    await expect(
      adapter.configureBranchProtection(REF, 'main', CONNECT_CONTRACT),
    ).rejects.toThrow(ForgeAuthError);
  });
});

describe('GitHubForgeAdapter — checkBranchProtectionDrift() (SC-14)', () => {
  it('reports no drift when live settings match the connect-time contract', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: connectTimeBranchProtectionFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift).toEqual({ drifted: false, differences: [] });
  });

  it('RED: flags drift when required-approving-review-count was loosened to 0 after connect', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: driftedApprovalCountFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toContainEqual({
      field: 'requiredApprovingReviewCount',
      expected: 1,
      actual: 0,
    });
  });

  it('RED: flags drift when force-push was re-enabled after connect', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: driftedForcePushFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toContainEqual({
      field: 'allowForcePushes',
      expected: false,
      actual: true,
    });
  });

  it('RED: flags drift when a required status-check context was dropped', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: driftedStatusChecksFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toContainEqual({
      field: 'requiredStatusChecks',
      expected: ['ci/gate'],
      actual: [],
    });
  });

  it('is order-insensitive on required status-check contexts (not a false-positive drift)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: {
        ...connectTimeBranchProtectionFixture,
        required_status_checks: { strict: true, contexts: ['ci/gate', 'ci/lint'] },
      },
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });
    const contract = {
      ...CONNECT_CONTRACT,
      requiredStatusChecks: ['ci/lint', 'ci/gate'],
    };

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', contract);
    expect(drift).toEqual({ drifted: false, differences: [] });
  });

  it('RED: flags maximal drift when branch protection was removed entirely (404)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 404,
      statusText: 'Not Found',
      body: { message: 'Branch not protected' },
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toHaveLength(1);
    expect(drift.differences[0]?.field).toBe('*');
  });
});
