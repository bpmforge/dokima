/** Repo ops chapter: GET /repos/{owner}/{repo}. */
import { ForgeResponseShapeError, type RepoInfo, type RepoRef } from './types.js';
import { requestGitHubApi } from './github-http.js';
import type { GitHubRuntime, RawRepo } from './github-types.js';

function parseRepo(id: string, raw: RawRepo): RepoInfo {
  if (!raw.permissions) {
    throw new ForgeResponseShapeError(id, 'repo response missing "permissions"');
  }
  return {
    fullName: raw.full_name,
    defaultBranch: raw.default_branch,
    private: raw.private,
    archived: raw.archived,
    permissions: {
      admin: raw.permissions.admin,
      push: raw.permissions.push,
      pull: raw.permissions.pull,
    },
  };
}

export async function getRepo(runtime: GitHubRuntime, ref: RepoRef): Promise<RepoInfo> {
  const raw = await requestGitHubApi<RawRepo>(
    runtime,
    `/repos/${ref.owner}/${ref.repo}`,
    { method: 'GET' },
    runtime.requestTimeoutMs,
  );
  return parseRepo(runtime.id, raw);
}
