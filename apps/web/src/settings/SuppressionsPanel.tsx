import { useCallback, useEffect, useState } from 'react';
import { createSuppression, fetchSuppressions } from './api-rules.js';
import { SettingsApiError } from './api-client.js';
import {
  SUPPRESSION_JUSTIFICATIONS,
  type Suppression,
  type SuppressionJustification,
} from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

export interface SuppressionsPanelProps {
  projectId: string;
}

/** Suppression review list with justifications (FR-RL3, AC3): human-signed, fixed-enum justification, auto-reopens on context-key mismatch. */
export function SuppressionsPanel({ projectId }: SuppressionsPanelProps) {
  const [suppressions, setSuppressions] = useState<Suppression[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    fingerprint: string;
    justification: SuppressionJustification;
    signature: string;
    contextKey: string;
  }>({ fingerprint: '', justification: 'false_positive', signature: '', contextKey: '' });

  const refresh = useCallback(async () => {
    try {
      setSuppressions(await fetchSuppressions(projectId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load suppressions'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!draft.fingerprint.trim() || !draft.signature.trim()) return;
    try {
      await createSuppression(projectId, draft.fingerprint.trim(), {
        justification: draft.justification,
        signature: draft.signature.trim(),
        contextKey: draft.contextKey.trim() || undefined,
      });
      setDraft({
        fingerprint: '',
        justification: 'false_positive',
        signature: '',
        contextKey: '',
      });
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create suppression'));
    }
  }, [draft, projectId, refresh]);

  if (!suppressions) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  return (
    <section aria-label="Suppression Review" data-testid="suppressions-panel">
      <p className="settings__hint">
        A machine identity cannot sign a suppression (SC-05) — the signature field is a
        human name. Suppressions auto-reopen when their context key changes (rule version,
        file content, dependency version).
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <table className="settings__table">
        <thead>
          <tr>
            <th>Fingerprint</th>
            <th>Rule</th>
            <th>Justification</th>
            <th>Signed by</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {suppressions.map((s) => (
            <tr key={s.id} data-testid="suppression-row">
              <td>{s.fingerprint}</td>
              <td>{s.ruleId ?? '—'}</td>
              <td>{s.justification}</td>
              <td>{s.signedBy}</td>
              <td>
                {s.status === 'reopened' ? (
                  <span className="settings__badge settings__badge--warn">reopened</span>
                ) : (
                  <span className="settings__badge">active</span>
                )}
              </td>
            </tr>
          ))}
          {suppressions.length === 0 && (
            <tr>
              <td colSpan={5}>No suppressions on record.</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        className="settings__row-form"
        aria-label="Create suppression"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <label>
          Finding fingerprint
          <input
            value={draft.fingerprint}
            onChange={(e) => setDraft({ ...draft, fingerprint: e.target.value })}
          />
        </label>
        <label>
          Justification
          <select
            value={draft.justification}
            onChange={(e) =>
              setDraft({
                ...draft,
                justification: e.target.value as SuppressionJustification,
              })
            }
          >
            {SUPPRESSION_JUSTIFICATIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <label>
          Signature (your name)
          <input
            value={draft.signature}
            onChange={(e) => setDraft({ ...draft, signature: e.target.value })}
          />
        </label>
        <button type="submit">Suppress</button>
      </form>
    </section>
  );
}
