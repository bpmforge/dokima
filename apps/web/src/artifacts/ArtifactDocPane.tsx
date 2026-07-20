/**
 * The selected deliverable's detail pane: version picker, per-ticket diff,
 * in-place edit (FR-P3, this ticket's AC1/AC2), and the comment thread
 * (FR-C8). Split out of `ArtifactViewer.tsx` (CODE_BOOK_PROTOCOL.md-style
 * barrel split, this ticket's AC4) so the edit state machine
 * (`useArtifactEdit.ts`) is unit-testable without the whole viewer.
 */

import { CommentThread } from './CommentThread.js';
import { DiffView } from './DiffView.js';
import { MarkdownView } from './MarkdownView.js';
import { useArtifactEdit } from './useArtifactEdit.js';
import type { ArtifactComment, ArtifactDoc } from './types.js';

export interface ArtifactDocPaneProps {
  doc: ArtifactDoc;
  selectedRev: string | undefined;
  onSelectRev: (rev: string) => void;
  ticketFilter: string;
  onTicketFilterChange: (value: string) => void;
  onOpenDiff: () => void;
  diffError: string | null;
  showDiff: boolean;
  diff: { oldContent: string; newContent: string } | null;
  comments: ArtifactComment[];
  onSubmitComment: (body: string) => void | Promise<void>;
  onViewDiffSince: (comment: ArtifactComment) => void | Promise<void>;
  submittingComment: boolean;
  onSaveEdit: (newContent: string, versionRef: string) => Promise<void>;
}

export function ArtifactDocPane({
  doc,
  selectedRev,
  onSelectRev,
  ticketFilter,
  onTicketFilterChange,
  onOpenDiff,
  diffError,
  showDiff,
  diff,
  comments,
  onSubmitComment,
  onViewDiffSince,
  submittingComment,
  onSaveEdit,
}: ArtifactDocPaneProps) {
  const edit = useArtifactEdit({
    content: doc.content,
    onSave: (newContent) => onSaveEdit(newContent, doc.rev ?? 'HEAD'),
  });

  return (
    <div className="artifact-viewer__detail">
      <div className="artifact-viewer__versions">
        <select
          aria-label="Version"
          value={selectedRev ?? doc.versions[0]?.rev ?? ''}
          onChange={(e) => onSelectRev(e.target.value)}
        >
          {doc.versions.map((v) => (
            <option key={v.rev} value={v.rev}>
              {v.at} — {v.subject}
            </option>
          ))}
        </select>
        <input
          aria-label="Ticket id for live diff"
          placeholder="Ticket id (e.g. W4-05)"
          value={ticketFilter}
          onChange={(e) => onTicketFilterChange(e.target.value)}
        />
        <button type="button" onClick={onOpenDiff}>
          Diff vs base
        </button>
        {!edit.editing && (
          <button type="button" onClick={edit.startEdit}>
            Edit
          </button>
        )}
      </div>
      {diffError && <p role="alert">{diffError}</p>}
      {edit.editing ? (
        <div className="artifact-viewer__edit" data-testid="artifact-edit">
          <textarea
            aria-label="Edit deliverable content"
            className="artifact-viewer__edit-textarea"
            value={edit.draft}
            onChange={(e) => edit.setDraft(e.target.value)}
          />
          {edit.error && <p role="alert">{edit.error}</p>}
          <div className="artifact-viewer__edit-actions">
            <button
              type="button"
              onClick={() => void edit.saveEdit()}
              disabled={edit.saveDisabled}
            >
              {edit.saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={edit.cancelEdit} disabled={edit.saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : showDiff && diff ? (
        <DiffView oldContent={diff.oldContent} newContent={diff.newContent} />
      ) : (
        <MarkdownView content={doc.content} />
      )}
      <CommentThread
        comments={comments}
        latestRev={doc.versions[0]?.rev}
        onSubmit={onSubmitComment}
        onViewDiffSince={onViewDiffSince}
        submitting={submittingComment}
      />
    </div>
  );
}
