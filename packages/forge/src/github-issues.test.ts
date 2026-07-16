import { describe, expect, it } from 'vitest';
import { createGitHubForgeAdapter } from './github.js';
import { ForgeIdentityError } from './types.js';
import { fakeFetch } from './github-test-helpers.js';
import {
  issueClosedFixture,
  issueCommentSuccessFixture,
  issueSuccessFixture,
} from './github-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };

describe('GitHubForgeAdapter — issue mirror primitives', () => {
  it('createIssue() sends title/body/labels/assignees under the maker identity', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: issueSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const issue = await adapter.createIssue(REF, {
      title: issueSuccessFixture.title,
      body: 'mirrored ticket body',
      labels: ['lane:integrations'],
      assignees: ['shipwright-maker'],
    });

    expect(issue).toEqual({
      number: 7,
      state: 'open',
      stateReason: null,
      title: issueSuccessFixture.title,
      body: 'mirrored ticket body',
      htmlUrl: 'https://github.com/shipwright-org/demo/issues/7',
      labels: ['lane:integrations'],
      assignees: ['shipwright-maker'],
    });
    expect(calls[0]?.headers.authorization).toBe('Bearer maker-token');
    expect(calls[0]?.body).toMatchObject({ labels: ['lane:integrations'] });
  });

  it('updateIssue() closes with a state_reason (close verb: state + receipt comment)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: issueClosedFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    const issue = await adapter.updateIssue(REF, 7, {
      state: 'closed',
      stateReason: 'completed',
    });

    expect(issue.state).toBe('closed');
    expect(issue.stateReason).toBe('completed');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ state: 'closed', state_reason: 'completed' });
  });

  it('commentOnIssue() as the reviewer identity (accept = reviewer comment, per US-502 AC-1)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: issueCommentSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({
      makerToken: 'maker-token',
      reviewerToken: 'reviewer-token',
      fetchImpl,
    });

    const comment = await adapter.commentOnIssue(
      REF,
      7,
      'accepted — reviewer!=author verified',
      'reviewer',
    );

    expect(comment.authorLogin).toBe('shipwright-reviewer');
    expect(calls[0]?.headers.authorization).toBe('Bearer reviewer-token');
  });

  it('commentOnIssue(reviewer) throws ForgeIdentityError when no reviewer token is configured', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 201,
      body: issueCommentSuccessFixture,
    }));
    const adapter = createGitHubForgeAdapter({ makerToken: 'maker-token', fetchImpl });

    await expect(adapter.commentOnIssue(REF, 7, 'accepted', 'reviewer')).rejects.toThrow(
      ForgeIdentityError,
    );
  });
});
