/**
 * Edit/Save/Cancel state machine for in-place deliverable editing (FR-P3;
 * this ticket's AC1/AC2). Kept separate from `ArtifactDocPane.tsx` so the
 * disabled-condition and error-state logic (review-caught gap: previously
 * zero coverage) can be driven directly in tests without mounting the full
 * pane.
 */

import { useCallback, useState } from 'react';

export interface UseArtifactEditOptions {
  /** The deliverable's current content — the edit textarea seeds from this. */
  content: string;
  /** Persists the edit (`ArtifactViewerRoot`'s `buildEditSubmission` + `postArtifactComment` call). Throwing leaves edit mode open with the error shown. */
  onSave: (newContent: string) => Promise<void>;
}

export interface ArtifactEditState {
  editing: boolean;
  draft: string;
  saving: boolean;
  error: string | null;
  /** Enters edit mode, seeding the draft from the current content. */
  startEdit: () => void;
  /** Discards the draft and exits edit mode without saving. */
  cancelEdit: () => void;
  /** Persists the draft; exits edit mode on success, stays open with `error` set on failure. */
  saveEdit: () => Promise<void>;
  setDraft: (value: string) => void;
  /** Disabled while saving, when the draft is empty/unchanged from the current content. */
  saveDisabled: boolean;
}

export function useArtifactEdit({
  content,
  onSave,
}: UseArtifactEditOptions): ArtifactEditState {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setDraft(content);
    setError(null);
    setEditing(true);
  }, [content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft('');
    setError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  const saveDisabled = saving || !draft.trim() || draft === content;

  return {
    editing,
    draft,
    saving,
    error,
    startEdit,
    cancelEdit,
    saveEdit,
    setDraft,
    saveDisabled,
  };
}
