/**
 * PR lifecycle chapter: create/list/get/close/merge.
 *
 * Two deltas from github-pr.ts, both load-bearing:
 * - `POST .../merge` returns an empty 200 body (Gitea's `#/responses/empty`)
 *   instead of a merge result — mergePullRequest re-fetches the PR
 *   afterward to read back `merge_commit_sha`/`merged`.
 * - Gitea's merge verb is `do` (enum merge/rebase/rebase-merge/squash/
 *   fast-forward-only/manually-merged), not `merge_method`; the SHA guard
 *   is `head_commit_id`, not `sha`.
 */
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
import { requestGiteaApi } from './gitea-http.js';
import type { GiteaRuntime, RawPullRequest } from './gitea-types.js';

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
  runtime: GiteaRuntime,
  ref: RepoRef,
  input: PullRequestInput,
  identity: ForgeIdentity = 'maker',
): Promise<PullRequestInfo> {
  const raw = await requestGiteaApi<RawPullRequest>(
    runtime,
    pullsPath(ref),
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  return parsePullRequest(runtime.id, raw);
}

export async function getPullRequest(
  runtime: GiteaRuntime,
  ref: RepoRef,
  number: number,
): Promise<PullRequestInfo> {
  const raw = await requestGiteaApi<RawPullRequest>(
    runtime,
    `${pullsPath(ref)}/${number}`,
    { method: 'GET' },
    runtime.requestTimeoutMs,
  );
  return parsePullRequest(runtime.id, raw);
}

export async function listPullRequests(
  runtime: GiteaRuntime,
  ref: RepoRef,
  state: PullRequestState | 'all' = 'open',
): Promise<PullRequestInfo[]> {
  const raw = await requestGiteaApi<RawPullRequest[]>(
    runtime,
    `${pullsPath(ref)}?state=${state}`,
    { method: 'GET' },
    runtime.requestTimeoutMs,
  );
  return raw.map((entry) => parsePullRequest(runtime.id, entry));
}

export async function closePullRequest(
  runtime: GiteaRuntime,
  ref: RepoRef,
  number: number,
  identity: ForgeIdentity = 'maker',
): Promise<PullRequestInfo> {
  const raw = await requestGiteaApi<RawPullRequest>(
    runtime,
    `${pullsPath(ref)}/${number}`,
    { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) },
    runtime.requestTimeoutMs,
    identity,
  );
  return parsePullRequest(runtime.id, raw);
}

const MERGE_METHOD_TO_GITEA_DO: Record<
  NonNullable<MergePullRequestInput['mergeMethod']>,
  string
> = {
  merge: 'merge',
  squash: 'squash',
  rebase: 'rebase',
};

/** SC-14: merge rights on main are reviewer/human-held — defaults to the `reviewer` identity. */
export async function mergePullRequest(
  runtime: GiteaRuntime,
  ref: RepoRef,
  number: number,
  input: MergePullRequestInput,
  identity: ForgeIdentity = 'reviewer',
): Promise<MergeResult> {
  await requestGiteaApi<undefined>(
    runtime,
    `${pullsPath(ref)}/${number}/merge`,
    {
      method: 'POST',
      body: JSON.stringify({
        do: MERGE_METHOD_TO_GITEA_DO[input.mergeMethod ?? 'merge'],
        merge_title_field: input.commitTitle,
        merge_message_field: input.commitMessage,
        head_commit_id: input.sha,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );

  const raw = await requestGiteaApi<RawPullRequest>(
    runtime,
    `${pullsPath(ref)}/${number}`,
    { method: 'GET' },
    runtime.requestTimeoutMs,
    identity,
  );
  if (raw.merged && !raw.merge_commit_sha) {
    throw new ForgeResponseShapeError(
      runtime.id,
      'pull request reports merged=true but is missing "merge_commit_sha"',
    );
  }
  return {
    sha: raw.merge_commit_sha ?? '',
    merged: raw.merged,
    message: raw.merged ? 'Pull Request has been merged' : 'Pull Request was not merged',
  };
}
