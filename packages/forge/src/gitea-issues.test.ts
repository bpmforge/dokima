import { describe, expect, it } from 'vitest';
import { createGiteaForgeAdapter } from './gitea.js';
import { ForgeResponseShapeError } from './types.js';
import { fakeFetch } from './gitea-test-helpers.js';
import {
  issueClosedFixture,
  issueCommentSuccessFixture,
  issueLabelsAppliedFixture,
  issueSuccessFixture,
} from './gitea-fixtures.js';

const REF = { owner: 'shipwright-org', repo: 'demo' };
const BASE_URL = 'https://gitea.example.com';

describe('GiteaForgeAdapter — issue mirror (FR-I2)', () => {
  it('createIssue() without labels does a single POST and reports stateReason=null (Gitea has no state_reason)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: issueSuccessFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const issue = await adapter.createIssue(REF, {
      title: 'W6-02 — Gitea adapter + generic git fallback',
      body: 'mirrored ticket body',
      assignees: ['shipwright-maker'],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({
      title: 'W6-02 — Gitea adapter + generic git fallback',
      body: 'mirrored ticket body',
      assignees: ['shipwright-maker'],
    });
    expect(issue).toEqual({
      number: 7,
      state: 'open',
      stateReason: null,
      title: 'W6-02 — Gitea adapter + generic git fallback',
      body: 'mirrored ticket body',
      htmlUrl: 'https://gitea.example.com/shipwright-org/demo/issues/7',
      labels: [],
      assignees: ['shipwright-maker'],
    });
  });

  it('createIssue() with labels follows up with PUT .../labels (Gitea has no labels field on the create body)', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'POST') return { status: 201, body: issueSuccessFixture };
      return { status: 200, body: issueLabelsAppliedFixture };
    });
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const issue = await adapter.createIssue(REF, {
      title: 'W6-02',
      labels: ['lane:integrations'],
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toBe(
      'https://gitea.example.com/api/v1/repos/shipwright-org/demo/issues/7/labels',
    );
    expect(calls[1]?.body).toEqual({ labels: ['lane:integrations'] });
    expect(issue.labels).toEqual(['lane:integrations']);
  });

  it('updateIssue() PATCHes state without touching labels when none are requested', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: issueClosedFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const issue = await adapter.updateIssue(REF, 7, { state: 'closed' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({
      state: 'closed',
      body: undefined,
      assignees: undefined,
    });
    expect(issue.state).toBe('closed');
    expect(issue.stateReason).toBeNull();
  });

  it('updateIssue() with labels PATCHes then PUTs .../labels and reports the names Gitea applied', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'PATCH') return { status: 201, body: issueSuccessFixture };
      return { status: 200, body: issueLabelsAppliedFixture };
    });
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const issue = await adapter.updateIssue(REF, 7, { labels: ['lane:integrations'] });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe('PUT');
    expect(issue.labels).toEqual(['lane:integrations']);
  });

  it('commentOnIssue() posts under the maker identity and parses the response', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: issueCommentSuccessFixture,
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    const comment = await adapter.commentOnIssue(REF, 7, 'accepted');

    expect(comment).toEqual({
      id: 5001,
      body: 'accepted — reviewer!=author verified',
      authorLogin: 'shipwright-reviewer',
      htmlUrl: 'https://gitea.example.com/shipwright-org/demo/issues/7#issuecomment-5001',
      createdAt: '2026-07-18T12:00:00Z',
    });
    expect(calls[0]?.body).toEqual({ body: 'accepted' });
  });

  it('commentOnIssue() throws ForgeResponseShapeError when user is missing from the response', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 201,
      body: { ...issueCommentSuccessFixture, user: null },
    }));
    const adapter = createGiteaForgeAdapter({
      baseUrl: BASE_URL,
      makerToken: 'maker-token',
      fetchImpl,
    });

    await expect(adapter.commentOnIssue(REF, 7, 'accepted')).rejects.toThrow(
      ForgeResponseShapeError,
    );
  });
});
