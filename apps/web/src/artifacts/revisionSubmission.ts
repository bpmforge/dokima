/**
 * Builds the wire payload for both ways a deliverable's content changes
 * through the artifact viewer: a short feedback comment, or an in-place
 * edit of the deliverable itself. Both travel over the same
 * `POST .../artifacts/comments` endpoint (FR-C8; there is no separate
 * doc-write route — `docs-routes.ts` is read-only, git-backed) so they
 * share this wire shape; what differs is *what the caller puts in `body`*
 * (short feedback text vs. the full revised document) and which UI action
 * produced it (`CommentThread`'s composer vs. `ArtifactViewer`'s
 * startEdit/saveEdit flow).
 *
 * `phase` is computed here via `deliverablePhase.ts` rather than left null
 * — this is the fix for the review-caught gap: `phase` was previously
 * always null on every submission, so `isGatedDeliverable`'s phase branch
 * (`apps/server/.../artifacts-routes/shared.ts`) was dead code.
 */

import { phaseForDeliverable } from './deliverablePhase.js';
import type { CreateCommentInput } from './types.js';

export interface CommentSubmissionInput {
  path: string;
  /** The feedback text a reviewer is leaving. */
  body: string;
  versionRef: string;
  ticketId?: string | null;
}

/** Builds the payload for a feedback comment left on a deliverable. */
export function buildCommentSubmission(
  input: CommentSubmissionInput,
): CreateCommentInput {
  return {
    path: input.path,
    body: input.body,
    versionRef: input.versionRef,
    ticketId: input.ticketId ?? null,
    phase: phaseForDeliverable(input.path),
  };
}

export interface EditSubmissionInput {
  path: string;
  /** The deliverable's full revised content (not a comment snippet). */
  content: string;
  versionRef: string;
  ticketId?: string | null;
}

/** Builds the payload for an in-place edit of a deliverable (FR-P3). */
export function buildEditSubmission(input: EditSubmissionInput): CreateCommentInput {
  return {
    path: input.path,
    body: input.content,
    versionRef: input.versionRef,
    ticketId: input.ticketId ?? null,
    phase: phaseForDeliverable(input.path),
  };
}
