/**
 * Inline feedback comments (FR-C8, R-H2): a comment on a gated deliverable
 * emits `revision.requested` (`comment.revisionRequested`). A comment is
 * resolved-by-reference once the deliverable has a version newer than the
 * one the comment was made against (`comment.versionRef !== latestRev`) —
 * "View diff since this comment" renders that revised version as a diff
 * against the commented version (FR-C8).
 */

import { useState } from 'react';
import type { ArtifactComment } from './types.js';

export interface CommentThreadProps {
  comments: ArtifactComment[];
  /** Newest known revision of the deliverable (`doc.versions[0]?.rev`) — drives resolved-by-reference. */
  latestRev?: string;
  onSubmit: (body: string) => void | Promise<void>;
  onViewDiffSince: (comment: ArtifactComment) => void | Promise<void>;
  submitting: boolean;
}

export function CommentThread({
  comments,
  latestRev,
  onSubmit,
  onViewDiffSince,
  submitting,
}: CommentThreadProps) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (!draft.trim()) return;
    void onSubmit(draft.trim());
    setDraft('');
  };

  return (
    <div className="comment-thread" data-testid="comment-thread">
      <ul className="comment-thread__list">
        {comments.map((comment) => {
          const resolved = Boolean(latestRev) && comment.versionRef !== latestRev;
          return (
            <li key={comment.seq} className="comment-thread__item">
              <p className="comment-thread__body">{comment.body}</p>
              <p className="comment-thread__meta">
                {comment.actorId} · v{comment.versionRef} ·{' '}
                {comment.revisionRequested ? (
                  <span className="comment-thread__gate">revision requested</span>
                ) : (
                  <span>no gate yet</span>
                )}
              </p>
              {resolved && (
                <p className="comment-thread__resolved">
                  <span>Resolved via {latestRev}</span>{' '}
                  <button type="button" onClick={() => void onViewDiffSince(comment)}>
                    View diff since this comment
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="comment-thread__composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave feedback on this deliverable…"
          aria-label="New comment"
        />
        <button type="button" onClick={submit} disabled={submitting || !draft.trim()}>
          {submitting ? 'Sending…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
