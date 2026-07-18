import { useCallback, useEffect, useState } from 'react';
import { fetchModelMatrix, putModelMatrix, SettingsApiError } from './api.js';
import {
  MODEL_MATRIX_PRESETS,
  TASK_TYPES,
  type ModelMatrix,
  type ModelMatrixRow,
  type TaskType,
} from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

const PRESET_LABEL: Record<(typeof MODEL_MATRIX_PRESETS)[number], string> = {
  'all-local': 'All-local',
  hybrid: 'Hybrid (local + frontier review)',
  'all-cloud': 'All-cloud',
};

export interface ModelMatrixPanelProps {
  projectId: string;
}

/** Model-to-role matrix (BLUEPRINT §3.1.4): rows = agent roles, columns = task types (AC1); fitness-card surfacing (W2-08) and the D-019 Copilot flag (AC6) render per row. */
export function ModelMatrixPanel({ projectId }: ModelMatrixPanelProps) {
  const [matrix, setMatrix] = useState<ModelMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ role: string; taskType: TaskType; model: string }>(
    {
      role: '',
      taskType: 'code',
      model: '',
    },
  );

  const refresh = useCallback(async () => {
    try {
      setMatrix(await fetchModelMatrix(projectId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the model matrix'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddRow = useCallback(async () => {
    if (!draft.role.trim() || !draft.model.trim()) return;
    const existing = matrix?.rows ?? [];
    try {
      const next = await putModelMatrix(projectId, [
        ...existing.map((r) => ({
          role: r.role,
          taskType: r.taskType,
          model: r.model,
          fallback: r.fallback,
        })),
        { role: draft.role.trim(), taskType: draft.taskType, model: draft.model.trim() },
      ]);
      setMatrix(next);
      setDraft({ role: '', taskType: 'code', model: '' });
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the model matrix'));
    }
  }, [draft, matrix, projectId]);

  if (!matrix) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  return (
    <section aria-label="Model Matrix" data-testid="model-matrix-panel">
      <p className="settings__hint">
        Presets: {MODEL_MATRIX_PRESETS.map((p) => PRESET_LABEL[p]).join(' · ')} (applying
        a preset lands with the first-run wizard).
      </p>
      {matrix.copilotEnabled && (
        <p className="settings__notice" role="status">
          Copilot consent is active — rows using a <code>copilot/</code>-prefixed model
          are flagged below.
        </p>
      )}
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <table className="settings__table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Task type</th>
            <th>Model</th>
            <th>Fallback chain</th>
            <th>Fitness</th>
            <th>Copilot</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row: ModelMatrixRow) => (
            <tr key={`${row.role}:${row.taskType}`}>
              <td>{row.role}</td>
              <td>{row.taskType}</td>
              <td>{row.model}</td>
              <td>{row.fallback.length > 0 ? row.fallback.join(' → ') : '—'}</td>
              <td>
                {/* No fitness-bench producer is wired to apps/server yet (packages/gateway/src/fitness
                    isn't a reachable dependency, see settings-types.ts) — honestly reports "not benched"
                    rather than a fabricated verdict (C-1), ready to surface a real card once wired. */}
                <span className="settings__badge settings__badge--muted">
                  not benched
                </span>
              </td>
              <td>
                {row.copilotBacked ? (
                  <span className="settings__badge settings__badge--warn">
                    Copilot-backed
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
          {matrix.rows.length === 0 && (
            <tr>
              <td colSpan={6}>No rows yet — add one below.</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        className="settings__row-form"
        aria-label="Add matrix row"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAddRow();
        }}
      >
        <label>
          Role
          <input
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            placeholder="coding-agent"
          />
        </label>
        <label>
          Task type
          <select
            value={draft.taskType}
            onChange={(e) =>
              setDraft({ ...draft, taskType: e.target.value as typeof draft.taskType })
            }
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="local/qwen2.5-coder or copilot/gpt-4"
          />
        </label>
        <button type="submit">Add / update row</button>
      </form>
    </section>
  );
}
