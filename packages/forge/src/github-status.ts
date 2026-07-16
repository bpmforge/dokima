/** Commit status chapter: POST /repos/{owner}/{repo}/statuses/{sha}. */
import type {
  CommitStatusInfo,
  CommitStatusInput,
  ForgeIdentity,
  RepoRef,
} from './types.js';
import { requestGitHubApi } from './github-http.js';
import type { GitHubRuntime, RawCommitStatus } from './github-types.js';

export async function createCommitStatus(
  runtime: GitHubRuntime,
  ref: RepoRef,
  sha: string,
  input: CommitStatusInput,
  identity: ForgeIdentity = 'maker',
): Promise<CommitStatusInfo> {
  const raw = await requestGitHubApi<RawCommitStatus>(
    runtime,
    `/repos/${ref.owner}/${ref.repo}/statuses/${sha}`,
    {
      method: 'POST',
      body: JSON.stringify({
        state: input.state,
        context: input.context,
        description: input.description,
        target_url: input.targetUrl,
      }),
    },
    runtime.requestTimeoutMs,
    identity,
  );
  return {
    id: raw.id,
    state: raw.state,
    context: raw.context,
    createdAt: raw.created_at,
  };
}
