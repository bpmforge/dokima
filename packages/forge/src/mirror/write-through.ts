/**
 * Verb-to-action write-through (FR-T5): the mapping gitea-issues.ts and
 * github-issues.ts both defer to this ticket —
 *   claim   = assign + label       (maker)
 *   evidence = comment              (maker)
 *   close   = state + receipt comment (maker)
 *   accept  = reviewer comment      (reviewer)
 * Each verb dispatches through `adapter`'s existing `updateIssue` /
 * `commentOnIssue` with the identity MIRROR_VERB_IDENTITY assigns it —
 * never a caller-supplied identity, so a mirror caller cannot accidentally
 * post an accept comment under the maker token.
 */
import {
  ForgeTimeoutError,
  ForgeUnreachableError,
  type ForgeAdapter,
  type RepoRef,
} from '../types.js';
import {
  MIRROR_VERB_IDENTITY,
  type MirrorWriteRequest,
  type MirrorWriteResult,
} from './types.js';

/** The slice of ForgeAdapter the mirror actually calls — same narrowing style as gitea-parity.ts's ParityCheckedAdapter. */
export type MirrorForgeAdapter = Pick<ForgeAdapter, 'updateIssue' | 'commentOnIssue'>;

/** Union that preserves input order, first occurrence wins, no duplicates. */
function mergeUnique(existing: string[] | undefined, additions: string[]): string[] {
  const merged = [...(existing ?? [])];
  for (const item of additions) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged;
}

function receiptCommentBody(receipt: {
  ticketId: string;
  ownerId: string;
  verifyCommand: string;
  verifyExitCode: number;
  commits: string[];
  files: string[];
  mintedAt: string;
}): string {
  return [
    `Close receipt for ${receipt.ticketId}`,
    `- owner: ${receipt.ownerId}`,
    `- verify: \`${receipt.verifyCommand}\` exit ${receipt.verifyExitCode}`,
    `- commits: ${receipt.commits.join(', ') || '(none)'}`,
    `- files: ${receipt.files.join(', ') || '(none)'}`,
    `- minted at: ${receipt.mintedAt}`,
  ].join('\n');
}

/**
 * Executes one mirror verb against the forge, under the identity FR-T5/
 * SC-03 assigns that verb. Throws whatever the adapter throws — including
 * ForgeUnreachableError/ForgeTimeoutError, which the queue module treats as
 * "go offline and retry later" rather than a hard failure.
 */
export async function writeThroughVerb(
  adapter: MirrorForgeAdapter,
  ref: RepoRef,
  issueNumber: number,
  request: MirrorWriteRequest,
): Promise<MirrorWriteResult> {
  const identity = MIRROR_VERB_IDENTITY[request.verb];

  switch (request.verb) {
    case 'claim': {
      const issue = await adapter.updateIssue(
        ref,
        issueNumber,
        {
          assignees: mergeUnique(request.existingAssignees, [request.assigneeLogin]),
          labels: mergeUnique(request.existingLabels, [request.label]),
        },
        identity,
      );
      return { verb: 'claim', identity, issue };
    }
    case 'evidence': {
      const comment = await adapter.commentOnIssue(
        ref,
        issueNumber,
        request.body,
        identity,
      );
      return { verb: 'evidence', identity, comment };
    }
    case 'close': {
      const issue = await adapter.updateIssue(
        ref,
        issueNumber,
        { state: 'closed', stateReason: 'completed' },
        identity,
      );
      const comment = await adapter.commentOnIssue(
        ref,
        issueNumber,
        receiptCommentBody(request.receipt),
        identity,
      );
      return { verb: 'close', identity, issue, comment };
    }
    case 'accept': {
      const comment = await adapter.commentOnIssue(
        ref,
        issueNumber,
        request.body,
        identity,
      );
      return { verb: 'accept', identity, comment };
    }
  }
}

/** True for the adapter errors that mean "forge unreachable right now" — the queue's trigger to go offline rather than fail. */
export function isOfflineForgeError(err: unknown): boolean {
  return err instanceof ForgeUnreachableError || err instanceof ForgeTimeoutError;
}
