import { describe, expect, it } from 'vitest';
import { createGiteaForgeAdapter } from './gitea.js';
import { ForgeAuthError, type BranchProtectionRules } from './types.js';
import { fakeFetch } from './gitea-test-helpers.js';
import {
  branchProtectionForbiddenFixture,
  connectTimeBranchProtectionFixture,
  driftedApprovalCountFixture,
  driftedForcePushFixture,
  driftedStatusChecksFixture,
} from './gitea-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };
const BASE_URL = 'https://gitea.example.com';

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

describe('GiteaForgeAdapter — configureBranchProtection() (FR-I2)', () => {
  it('creates a new rule (POST) when none exists yet for the branch', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => ({
      status: call.method === 'GET' ? 404 : 201,
      body:
        call.method === 'GET'
          ? { message: 'not found' }
          : connectTimeBranchProtectionFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await adapter.configureBranchProtection(REF, 'main', CONNECT_CONTRACT);

    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/branch_protections',
    );
    expect(calls[1]?.body).toEqual({
      rule_name: 'main',
      branch_name: 'main',
      required_approvals: 1,
      dismiss_stale_approvals: true,
      enable_status_check: true,
      status_check_contexts: ['ci/gate'],
      block_on_outdated_branch: true,
      block_admin_merge_override: true,
      enable_force_push: false,
    });
  });

  it('edits the existing rule (PATCH) when one is already present for the branch', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: connectTimeBranchProtectionFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await adapter.configureBranchProtection(REF, 'main', CONNECT_CONTRACT);

    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('PATCH');
    expect(calls[1]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/branch_protections/main',
    );
    expect(calls[1]?.body).toEqual({
      required_approvals: 1,
      dismiss_stale_approvals: true,
      enable_status_check: true,
      status_check_contexts: ['ci/gate'],
      block_on_outdated_branch: true,
      block_admin_merge_override: true,
      enable_force_push: false,
    });
  });

  it('throws ForgeAuthError when the caller lacks admin rights (HP-6)', async () => {
    const { fetchImpl } = fakeFetch((call) => {
      if (call.method === 'GET') return { status: 404, body: { message: 'not found' } };
      return {
        status: branchProtectionForbiddenFixture.status,
        statusText: branchProtectionForbiddenFixture.statusText,
        body: JSON.parse(branchProtectionForbiddenFixture.body),
      };
    });
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(
      adapter.configureBranchProtection(REF, 'main', CONNECT_CONTRACT),
    ).rejects.toThrow(ForgeAuthError);
  });
});

describe('GiteaForgeAdapter — checkBranchProtectionDrift() (SC-14, FR-I2)', () => {
  it('reports no drift when live settings match the connect-time contract', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: connectTimeBranchProtectionFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift).toEqual({ drifted: false, differences: [] });
  });

  it('RED: flags drift when required-approvals was loosened to 0 after connect', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: driftedApprovalCountFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

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
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

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
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toContainEqual({
      field: 'requiredStatusChecks',
      expected: ['ci/gate'],
      actual: [],
    });
  });

  it('RED: flags drift when allowDeletions was requested true — Gitea has no such toggle, protected branches are always undeletable', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: connectTimeBranchProtectionFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', {
      ...CONNECT_CONTRACT,
      allowDeletions: true,
    });
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toContainEqual({
      field: 'allowDeletions',
      expected: true,
      actual: false,
    });
  });

  it('is order-insensitive on required status-check contexts (not a false-positive drift)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: {
        ...connectTimeBranchProtectionFixture,
        status_check_contexts: ['ci/gate', 'ci/lint'],
      },
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });
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
      body: { message: 'Branch protection not found' },
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const drift = await adapter.checkBranchProtectionDrift(REF, 'main', CONNECT_CONTRACT);
    expect(drift.drifted).toBe(true);
    expect(drift.differences).toHaveLength(1);
    expect(drift.differences[0]?.field).toBe('*');
  });
});
