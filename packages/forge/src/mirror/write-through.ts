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
 *
 * close and accept both embed a non-spoofable receipt anchor
 * (computeReceiptAnchor, W6-08/SC-15) in their comment bodies —
 * reconciliation.ts trusts only the reviewer-authored accept comment
 * carrying it, since a maker-authored comment (evidence or otherwise) can
 * never satisfy that check.
 */
import {
  ForgeTimeoutError,
  ForgeUnreachableError,
  type ForgeAdapter,
  type RepoRef,
} from '../types.js';
import {
  MIRROR_VERB_IDENTITY,
  computeReceiptAnchor,
  type MirrorCloseReceiptSummary,
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

function receiptCommentBody(receipt: MirrorCloseReceiptSummary): string {
  return [
    `Close receipt for ${receipt.ticketId}`,
    `- owner: ${receipt.ownerId}`,
    `- verify: \`${receipt.verifyCommand}\` exit ${receipt.verifyExitCode}`,
    `- commits: ${receipt.commits.join(', ') || '(none)'}`,
    `- files: ${receipt.files.join(', ') || '(none)'}`,
    `- minted at: ${receipt.mintedAt}`,
    `- anchor: ${computeReceiptAnchor(receipt)}`,
  ].join('\n');
}

/**
 * The accept comment's only load-bearing content, as far as
 * reconciliation.ts (W6-08) is concerned, is this anchor line — the human
 * `body` is caller-supplied review commentary, kept for the forge timeline
 * but never what the audit matches on.
 */
function acceptCommentBody(
  body: string,
  closeReceipt: MirrorCloseReceiptSummary,
): string {
  return [
    body,
    '',
    `Confirms close receipt for ${closeReceipt.ticketId}`,
    `- anchor: ${computeReceiptAnchor(closeReceipt)}`,
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
        acceptCommentBody(request.body, request.closeReceipt),
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
