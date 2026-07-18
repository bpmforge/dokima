/**
 * Commit status chapter: POST /repos/{owner}/{repo}/statuses/{sha}.
 *
 * Wire delta from github-status.ts: Gitea's response field is `status`, not
 * `state` (the request field, `CreateStatusOption.state`, does match), and
 * Gitea's state enum is wider (`warning`, `skipped` in addition to the four
 * this adapter's contract exposes) — a value outside the contract's set can
 * only come back if something else touched the same SHA, so it surfaces as
 * a shape error rather than being silently narrowed.
 */
import {
  ForgeResponseShapeError,
  type CommitStatusInfo,
  type CommitStatusInput,
  type CommitStatusState,
  type ForgeIdentity,
  type RepoRef,
} from './types.js';
import { requestGiteaApi } from './gitea-http.js';
import type { GiteaRuntime, RawCommitStatus } from './gitea-types.js';

const KNOWN_STATES: readonly CommitStatusState[] = [
  'pending',
  'success',
  'error',
  'failure',
];

function parseState(id: string, raw: RawCommitStatus['status']): CommitStatusState {
  if ((KNOWN_STATES as readonly string[]).includes(raw)) return raw as CommitStatusState;
  throw new ForgeResponseShapeError(id, `unexpected commit status "${raw}"`);
}

export async function createCommitStatus(
  runtime: GiteaRuntime,
  ref: RepoRef,
  sha: string,
  input: CommitStatusInput,
  identity: ForgeIdentity = 'maker',
): Promise<CommitStatusInfo> {
  const raw = await requestGiteaApi<RawCommitStatus>(
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
    state: parseState(runtime.id, raw.status),
    context: raw.context,
    createdAt: raw.created_at,
  };
}
