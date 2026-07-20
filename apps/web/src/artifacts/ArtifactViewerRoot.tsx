/**
 * Artifact Viewer + Receipt Inspector (FR-C3/C5/C8, UX_SPEC §5) — the
 * `artifacts` pane's content. Mounted via a `createPortal` into the
 * already-rendered `[data-testid="pane-artifacts"]` DOM node from
 * `App.tsx`, the same technique `chat/ChatView.tsx` (W4-04) established for
 * mounting pane content without editing `layout/SplitPaneWorkspace.tsx`
 * (outside this ticket's write_scope).
 *
 * Split into a barrel (`ArtifactViewer.tsx`) + this root + `ArtifactDocPane`
 * / `ArtifactReceiptsPane` (this ticket's AC4): the detail pane and its
 * edit-in-place flow (AC1/AC2) live in `ArtifactDocPane.tsx` /
 * `useArtifactEdit.ts`.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchArtifactComments,
  fetchArtifactDiff,
  fetchArtifactDoc,
  fetchArtifactDocDiff,
  fetchArtifactList,
  fetchReceipt,
  fetchReceipts,
  postArtifactComment,
} from './api.js';
import { ArtifactDocPane } from './ArtifactDocPane.js';
import { ArtifactReceiptsPane } from './ArtifactReceiptsPane.js';
import { EmptyState } from './EmptyState.js';
import { buildCommentSubmission, buildEditSubmission } from './revisionSubmission.js';
import './artifacts.css';
import type {
  ArtifactComment,
  ArtifactDoc,
  ArtifactListItem,
  ReceiptRecord,
} from './types.js';

/** Live-update substitute (FR-C3's WS/≤1s push is deferred — see module HANDOFF below). */
const POLL_INTERVAL_MS = 5_000;

export interface ArtifactViewerProps {
  projectId: string;
  token: string;
}

type Tab = 'docs' | 'receipts';

export function ArtifactViewer({ projectId, token }: ArtifactViewerProps) {
  const [tab, setTab] = useState<Tab>('docs');
  const [items, setItems] = useState<ArtifactListItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [doc, setDoc] = useState<ArtifactDoc | null>(null);
  const [selectedRev, setSelectedRev] = useState<string | undefined>(undefined);
  const [comments, setComments] = useState<ArtifactComment[]>([]);
  const [ticketFilter, setTicketFilter] = useState('');
  const [diff, setDiff] = useState<{
    branch: string;
    base: string;
    oldContent: string;
    newContent: string;
  } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const opts = { getToken: () => token };

  const loadList = useCallback(async () => {
    try {
      const list = await fetchArtifactList(projectId, opts);
      setItems(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, token]);

  useEffect(() => {
    void loadList();
    const id = window.setInterval(() => void loadList(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loadList]);

  const loadDoc = useCallback(
    async (path: string, rev?: string) => {
      try {
        const fetched = await fetchArtifactDoc(projectId, path, rev, opts);
        setDoc(fetched);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId, token],
  );

  const loadComments = useCallback(
    async (path: string) => {
      try {
        setComments(await fetchArtifactComments(projectId, path, opts));
      } catch {
        setComments([]);
      }
    },
    [projectId, token],
  );

  useEffect(() => {
    if (!selectedPath) return;
    void loadDoc(selectedPath, selectedRev);
    void loadComments(selectedPath);
    setShowDiff(false);
    setDiff(null);
    setDiffError(null);
  }, [selectedPath, selectedRev, loadDoc, loadComments]);

  /** Poll the selected doc's versions + comments so a revision landed elsewhere resolves comments live (FR-C8). */
  useEffect(() => {
    if (!selectedPath) return;
    const id = window.setInterval(() => {
      void loadDoc(selectedPath, selectedRev);
      void loadComments(selectedPath);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [selectedPath, selectedRev, loadDoc, loadComments]);

  useEffect(() => {
    if (tab !== 'receipts') return;
    void fetchReceipts(projectId, {}, opts).then(setReceipts);
  }, [tab, projectId, token]);

  const openDiff = async () => {
    if (!selectedPath || !ticketFilter.trim()) return;
    try {
      const result = await fetchArtifactDiff(
        projectId,
        selectedPath,
        ticketFilter.trim(),
        opts,
      );
      setDiff(result);
      setDiffError(null);
      setShowDiff(true);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
      setShowDiff(false);
    }
  };

  /** FR-C8: renders the revised deliverable as a diff against the version a comment was made on. */
  const viewDiffSinceComment = async (comment: ArtifactComment) => {
    if (!selectedPath) return;
    try {
      const result = await fetchArtifactDocDiff(
        projectId,
        selectedPath,
        comment.versionRef,
        selectedRev,
        opts,
      );
      setDiff({
        branch: `comment #${comment.seq}`,
        base: comment.versionRef,
        oldContent: result.oldContent,
        newContent: result.newContent,
      });
      setDiffError(null);
      setShowDiff(true);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
      setShowDiff(false);
    }
  };

  const submitComment = async (body: string) => {
    if (!selectedPath || !doc) return;
    setSubmittingComment(true);
    try {
      await postArtifactComment(
        projectId,
        buildCommentSubmission({
          path: selectedPath,
          body,
          versionRef: doc.rev ?? 'HEAD',
        }),
        opts,
      );
      await loadComments(selectedPath);
    } finally {
      setSubmittingComment(false);
    }
  };

  /** FR-P3: an in-place edit persists through the same comment→revision-flow channel as feedback (no direct doc-write route exists). */
  const saveEdit = async (newContent: string, versionRef: string) => {
    if (!selectedPath) return;
    await postArtifactComment(
      projectId,
      buildEditSubmission({ path: selectedPath, content: newContent, versionRef }),
      opts,
    );
    await loadComments(selectedPath);
    setDoc((prev) => (prev ? { ...prev, content: newContent } : prev));
  };

  const openReceiptFromBadge = async (id: string) => {
    try {
      setSelectedReceipt(await fetchReceipt(projectId, id, opts));
      setTab('receipts');
    } catch {
      // Badge pointed at a receipt this project's log doesn't have — leave the current view.
    }
  };

  return (
    <div className="artifact-viewer" data-testid="artifact-viewer">
      <div className="artifact-viewer__tabs">
        <button
          type="button"
          className={tab === 'docs' ? 'artifact-viewer__tab--active' : ''}
          onClick={() => setTab('docs')}
        >
          Docs
        </button>
        <button
          type="button"
          className={tab === 'receipts' ? 'artifact-viewer__tab--active' : ''}
          onClick={() => setTab('receipts')}
        >
          Receipts
        </button>
      </div>

      {loadError && <p role="alert">{loadError}</p>}

      {tab === 'docs' && (
        <div className="artifact-viewer__docs">
          {items.length === 0 ? (
            <EmptyState copy="Deliverables appear as phases produce them." />
          ) : (
            <>
              <ul className="artifact-viewer__list">
                {items.map((item) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className={
                        selectedPath === item.path ? 'artifact-viewer__doc--active' : ''
                      }
                      onClick={() => {
                        setSelectedPath(item.path);
                        setSelectedRev(undefined);
                      }}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>

              {doc && (
                <ArtifactDocPane
                  key={selectedPath}
                  doc={doc}
                  selectedRev={selectedRev}
                  onSelectRev={setSelectedRev}
                  ticketFilter={ticketFilter}
                  onTicketFilterChange={setTicketFilter}
                  onOpenDiff={() => void openDiff()}
                  diffError={diffError}
                  showDiff={showDiff}
                  diff={diff}
                  comments={comments}
                  onSubmitComment={submitComment}
                  onViewDiffSince={viewDiffSinceComment}
                  submittingComment={submittingComment}
                  onSaveEdit={saveEdit}
                />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'receipts' && (
        <div className="artifact-viewer__receipts">
          <ArtifactReceiptsPane
            receipts={receipts}
            selectedReceipt={selectedReceipt}
            onSelectReceipt={(id) => void openReceiptFromBadge(id)}
          />
        </div>
      )}
    </div>
  );
}
