/** Fake MirrorForgeAdapter for mirror unit tests — no HTTP, no fixtures, just a call log. */
import type {
  ForgeIdentity,
  IssueComment,
  IssueInfo,
  IssueUpdate,
  RepoRef,
} from '../types.js';
import type { MirrorForgeAdapter } from './write-through.js';

export interface RecordedCall {
  op: 'updateIssue' | 'commentOnIssue';
  ref: RepoRef;
  issueNumber: number;
  identity: ForgeIdentity;
  update?: IssueUpdate;
  body?: string;
}

export interface FakeMirrorAdapter extends MirrorForgeAdapter {
  calls: RecordedCall[];
}

/**
 * `throwOnCall` lets a test simulate "forge unreachable for call N, then
 * recovers" — the shape queue/flush tests need without faking real HTTP.
 * `callIndex` is 0-based and counts every call made to this adapter
 * instance across its lifetime (updateIssue + commentOnIssue share one
 * counter), so a test can target e.g. "fail the 2nd call only".
 */
export function fakeMirrorAdapter(opts?: {
  throwOnCall?: (callIndex: number) => Error | undefined;
}): FakeMirrorAdapter {
  const calls: RecordedCall[] = [];
  let commentSeq = 1;

  function maybeThrow(): void {
    const index = calls.length - 1;
    const err = opts?.throwOnCall?.(index);
    if (err) throw err;
  }

  return {
    calls,
    async updateIssue(
      ref: RepoRef,
      issueNumber: number,
      update: IssueUpdate,
      identity: ForgeIdentity = 'maker',
    ): Promise<IssueInfo> {
      calls.push({ op: 'updateIssue', ref, issueNumber, identity, update });
      maybeThrow();
      return {
        number: issueNumber,
        state: update.state ?? 'open',
        stateReason: update.stateReason ?? null,
        title: `issue ${issueNumber}`,
        body: update.body ?? null,
        htmlUrl: `https://example.test/issues/${issueNumber}`,
        labels: update.labels ?? [],
        assignees: update.assignees ?? [],
      };
    },
    async commentOnIssue(
      ref: RepoRef,
      issueNumber: number,
      body: string,
      identity: ForgeIdentity = 'maker',
    ): Promise<IssueComment> {
      calls.push({ op: 'commentOnIssue', ref, issueNumber, identity, body });
      maybeThrow();
      return {
        id: commentSeq++,
        body,
        authorLogin: identity === 'reviewer' ? 'dokima-reviewer' : 'dokima-maker',
        htmlUrl: `https://example.test/issues/${issueNumber}#comment`,
        createdAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
}

export const TEST_REF: RepoRef = { owner: 'acme', repo: 'widget' };
