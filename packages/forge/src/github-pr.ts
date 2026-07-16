/** PR lifecycle chapter: create/list/get/close/merge. */
import {
  ForgeResponseShapeError,
  type ForgeIdentity,
  type MergePullRequestInput,
  type MergeResult,
  type PullRequestInfo,
  type PullRequestInput,
  type PullRequestState,
  type RepoRef,
} from './types.js';
import { requestGitHubApi } from './github-http.js';
import type { GitHubRuntime, RawMergeResult, RawPullRequest } from './github-types.js';

function pullsPath(ref: RepoRef): string {
  return `/repos/${ref.owner}/${ref.repo}/pulls`;
}

function parsePullRequest(id: string, raw: RawPullRequest): PullRequestInfo {
  if (!raw.user) {
    throw new ForgeResponseShapeError(id, 'pull request response missing "user.login"');
  }
  return {
    number: raw.number,
    state: raw.state,
    title: raw.title,
    body: raw.body,
    htmlUrl: raw.html_url,
    authorLogin: raw.user.login,
    headRef: raw.head.ref,
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    merged: raw.merged,
  };
}

export async function createPullRequest(
  runtime: GitHubRuntime,
  ref: RepoRef,
  input: PullRequestInput,
  identity: ForgeIdentity = 'maker',
): Promise<PullRequestInfo> {
  const raw = await requestGitHubApi<RawPullRequest>(
    runtime,
    pullsPath(ref),
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
        draft: input.draft,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  return parsePullRequest(runtime.id, raw);
}

export async function getPullRequest(
  runtime: GitHubRuntime,
  ref: RepoRef,
  number: number,
): Promise<PullRequestInfo> {
  const raw = await requestGitHubApi<RawPullRequest>(
    runtime,
    `${pullsPath(ref)}/${number}`,
    { method: 'GET' },
    runtime.requestTimeoutMs,
  );
  return parsePullRequest(runtime.id, raw);
}

export async function listPullRequests(
  runtime: GitHubRuntime,
  ref: RepoRef,
  state: PullRequestState | 'all' = 'open',
): Promise<PullRequestInfo[]> {
  const raw = await requestGitHubApi<RawPullRequest[]>(
    runtime,
    `${pullsPath(ref)}?state=${state}`,
    { method: 'GET' },
    runtime.requestTimeoutMs,
  );
  return raw.map((entry) => parsePullRequest(runtime.id, entry));
}

export async function closePullRequest(
  runtime: GitHubRuntime,
  ref: RepoRef,
  number: number,
  identity: ForgeIdentity = 'maker',
): Promise<PullRequestInfo> {
  const raw = await requestGitHubApi<RawPullRequest>(
    runtime,
    `${pullsPath(ref)}/${number}`,
    { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) },
    runtime.requestTimeoutMs,
    identity,
  );
  return parsePullRequest(runtime.id, raw);
}

/** SC-14: merge rights on main are reviewer/human-held — defaults to the `reviewer` identity. */
export async function mergePullRequest(
  runtime: GitHubRuntime,
  ref: RepoRef,
  number: number,
  input: MergePullRequestInput,
  identity: ForgeIdentity = 'reviewer',
): Promise<MergeResult> {
  const raw = await requestGitHubApi<RawMergeResult>(
    runtime,
    `${pullsPath(ref)}/${number}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
        sha: input.sha,
        merge_method: input.mergeMethod,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  return { sha: raw.sha, merged: raw.merged, message: raw.message };
}
