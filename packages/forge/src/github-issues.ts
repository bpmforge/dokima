/** Issue mirror primitives: create/update/comment. Verb-to-action mapping (claim=assign+label etc.) is W6-03's job; this chapter only exposes the CRUD the mirror builds on. */
import {
  ForgeResponseShapeError,
  type ForgeIdentity,
  type IssueComment,
  type IssueInfo,
  type IssueInput,
  type IssueUpdate,
  type RepoRef,
} from './types.js';
import { requestGitHubApi } from './github-http.js';
import type { GitHubRuntime, RawIssue, RawIssueComment } from './github-types.js';

function issuesPath(ref: RepoRef): string {
  return `/repos/${ref.owner}/${ref.repo}/issues`;
}

function parseIssue(raw: RawIssue): IssueInfo {
  return {
    number: raw.number,
    state: raw.state,
    stateReason: raw.state_reason,
    title: raw.title,
    body: raw.body,
    htmlUrl: raw.html_url,
    labels: raw.labels.map((label) =>
      typeof label === 'string' ? label : (label.name ?? ''),
    ),
    assignees: (raw.assignees ?? []).map((assignee) => assignee.login),
  };
}

export async function createIssue(
  runtime: GitHubRuntime,
  ref: RepoRef,
  input: IssueInput,
  identity: ForgeIdentity = 'maker',
): Promise<IssueInfo> {
  const raw = await requestGitHubApi<RawIssue>(
    runtime,
    issuesPath(ref),
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        labels: input.labels,
        assignees: input.assignees,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  return parseIssue(raw);
}

export async function updateIssue(
  runtime: GitHubRuntime,
  ref: RepoRef,
  number: number,
  update: IssueUpdate,
  identity: ForgeIdentity = 'maker',
): Promise<IssueInfo> {
  const raw = await requestGitHubApi<RawIssue>(
    runtime,
    `${issuesPath(ref)}/${number}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        state: update.state,
        state_reason: update.stateReason,
        body: update.body,
        labels: update.labels,
        assignees: update.assignees,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  return parseIssue(raw);
}

export async function commentOnIssue(
  runtime: GitHubRuntime,
  ref: RepoRef,
  number: number,
  body: string,
  identity: ForgeIdentity = 'maker',
): Promise<IssueComment> {
  const raw = await requestGitHubApi<RawIssueComment>(
    runtime,
    `${issuesPath(ref)}/${number}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
    runtime.requestTimeoutMs,
    identity,
  );
  if (!raw.user) {
    throw new ForgeResponseShapeError(
      runtime.id,
      'issue comment response missing "user.login"',
    );
  }
  return {
    id: raw.id,
    body: raw.body,
    authorLogin: raw.user.login,
    htmlUrl: raw.html_url,
    createdAt: raw.created_at,
  };
}
