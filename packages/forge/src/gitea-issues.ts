/**
 * Issue mirror primitives: create/update/comment (verb-to-action mapping is
 * W6-03's job; this chapter only exposes the CRUD the mirror builds on).
 *
 * Two deltas from github-issues.ts, both load-bearing:
 * - Gitea's `CreateIssueOption`/`EditIssueOption` bodies have no `labels`
 *   field at all (or accept only numeric label IDs, not names) — labels are
 *   set via the dedicated `PUT /issues/{index}/labels` endpoint, whose
 *   `IssueLabelsOption.labels` accepts either IDs or name strings (Gitea
 *   swagger, "Labels can be a list of integers representing label IDs or a
 *   list of strings representing label names"). createIssue/updateIssue
 *   route any requested label names through that endpoint as a follow-up
 *   call, then report back the names Gitea actually applied.
 * - Gitea's Issue schema carries no `state_reason` (GitHub-only concept) —
 *   `stateReason` is always `null` here; a caller-requested
 *   `update.stateReason` has nothing to be sent to.
 */
import {
  ForgeResponseShapeError,
  type ForgeIdentity,
  type IssueComment,
  type IssueInfo,
  type IssueInput,
  type IssueUpdate,
  type RepoRef,
} from './types.js';
import { requestGiteaApi } from './gitea-http.js';
import type { GiteaRuntime, RawComment, RawIssue, RawIssueLabel } from './gitea-types.js';

function issuesPath(ref: RepoRef): string {
  return `/repos/${ref.owner}/${ref.repo}/issues`;
}

function parseIssue(raw: RawIssue, labelNames?: string[]): IssueInfo {
  return {
    number: raw.number,
    state: raw.state,
    stateReason: null,
    title: raw.title,
    body: raw.body,
    htmlUrl: raw.html_url,
    labels: labelNames ?? (raw.labels ?? []).map((label) => label.name),
    assignees: (raw.assignees ?? []).map((assignee) => assignee.login),
  };
}

async function setLabels(
  runtime: GiteaRuntime,
  ref: RepoRef,
  number: number,
  labels: string[],
  identity: ForgeIdentity,
): Promise<string[]> {
  const raw = await requestGiteaApi<RawIssueLabel[]>(
    runtime,
    `${issuesPath(ref)}/${number}/labels`,
    { method: 'PUT', body: JSON.stringify({ labels }) },
    runtime.requestTimeoutMs,
    identity,
  );
  return raw.map((label) => label.name);
}

export async function createIssue(
  runtime: GiteaRuntime,
  ref: RepoRef,
  input: IssueInput,
  identity: ForgeIdentity = 'maker',
): Promise<IssueInfo> {
  const raw = await requestGiteaApi<RawIssue>(
    runtime,
    issuesPath(ref),
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        assignees: input.assignees,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  if (input.labels && input.labels.length > 0) {
    const labelNames = await setLabels(runtime, ref, raw.number, input.labels, identity);
    return parseIssue(raw, labelNames);
  }
  return parseIssue(raw);
}

export async function updateIssue(
  runtime: GiteaRuntime,
  ref: RepoRef,
  number: number,
  update: IssueUpdate,
  identity: ForgeIdentity = 'maker',
): Promise<IssueInfo> {
  const raw = await requestGiteaApi<RawIssue>(
    runtime,
    `${issuesPath(ref)}/${number}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        state: update.state,
        body: update.body,
        assignees: update.assignees,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  if (update.labels !== undefined) {
    const labelNames = await setLabels(runtime, ref, number, update.labels, identity);
    return parseIssue(raw, labelNames);
  }
  return parseIssue(raw);
}

export async function commentOnIssue(
  runtime: GiteaRuntime,
  ref: RepoRef,
  number: number,
  body: string,
  identity: ForgeIdentity = 'maker',
): Promise<IssueComment> {
  const raw = await requestGiteaApi<RawComment>(
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
