import { useCallback, useEffect, useState } from 'react';
import { MatrixFitnessCell } from './MatrixFitnessCell.js';
import {
  fetchModelMatrix,
  putModelMatrix,
  SettingsApiError,
  type ModelMatrixWithScope,
  benchModel,
} from './api.js';
import {
  MODEL_MATRIX_PRESETS,
  TASK_TYPES,
  type ModelMatrixRow,
  type TaskType,
} from './types.js';
import {
  combinedModelOptions,
  findServingProviderId,
  type ProviderCatalog,
  type ProviderEntry,
} from './providers-api.js';

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
  /** W12-35: per-provider model lists, owned by SettingsPage. */
  catalogs: Record<string, ProviderCatalog>;
  /** `enabled` per entry tells "missing" from "unroutable" (§6a). */
  providerEntries: ProviderEntry[];
}

function rowKey(role: string, taskType: TaskType): string {
  return `${role}:${taskType}`;
}

/**
 * Model-to-role matrix (BLUEPRINT §3.1.4): rows = agent roles, columns = task
 * types (AC1); fitness (W2-08/W19-06) and the D-019 Copilot flag render per
 * row. Composes `ProvidersPanel` above it (UX_SPEC §6a) so the Model field
 * is a `<select>` backed by the discovered catalog, never a bare string.
 */
export function ModelMatrixPanel({
  projectId,
  catalogs,
  providerEntries,
}: ModelMatrixPanelProps) {
  const [matrix, setMatrix] = useState<ModelMatrixWithScope | null>(null);
  // W10-64: optionally write the every-project preset. Off by default — a
  // global write is never the thing an unread click does.
  const [applyGlobally, setApplyGlobally] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // W12-35: catalogs/entries are PROPS (owned by SettingsPage) — as local
  // state fed by a self-mounted ProvidersPanel, the discovered catalog lived
  // in whichever tab's instance did the discovering, and the Model picker
  // arrived empty for a user who registered a provider on the other one.
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  // W19-06: per-row bench state — 'running' | verdict | 'failed'.
  const [benchState, setBenchState] = useState<Record<string, string>>({});
  const runBench = useCallback(
    async (role: string, taskType: TaskType) => {
      const key = rowKey(role, taskType);
      setBenchState((prev) => ({ ...prev, [key]: 'running' }));
      try {
        const result = await benchModel(projectId, role);
        setBenchState((prev) => ({ ...prev, [key]: result.verdict }));
      } catch {
        setBenchState((prev) => ({ ...prev, [key]: 'failed' }));
      }
    },
    [projectId],
  );
  const [fallbackDraft, setFallbackDraft] = useState<{ key: string; value: string }>({
    key: '',
    value: '',
  });

  // W17-08: until this editor, fallback[] was render-only and every
  // escalation ladder (W16-01) had exactly one rung.
  const saveRowFallback = async (target: ModelMatrixRow, fallback: string[]) => {
    const key = rowKey(target.role, target.taskType);
    try {
      const next = await putModelMatrix(
        projectId,
        (matrix?.rows ?? []).map((r) => ({
          role: r.role,
          taskType: r.taskType,
          model: r.model,
          fallback:
            rowKey(r.role, r.taskType) === key ? fallback : r.fallback,
        })),
        applyGlobally ? { scope: 'global' } : {},
      );
      setMatrix(next);
      setRowError(null);
    } catch (err) {
      setRowError({ key, message: errorMessage(err, 'Failed to save the fallback chain') });
    }
  };
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
    const key = rowKey(draft.role.trim(), draft.taskType);
    const existing = matrix?.rows ?? [];
    try {
      const next = await putModelMatrix(
        projectId,
        [
          ...existing.map((r) => ({
            role: r.role,
            taskType: r.taskType,
            model: r.model,
            fallback: r.fallback,
          })),
          {
            role: draft.role.trim(),
            taskType: draft.taskType,
            model: draft.model.trim(),
          },
        ],
        applyGlobally ? { scope: 'global' } : {},
      );
      setMatrix(next);
      setDraft({ role: '', taskType: 'code', model: '' });
      setError(null);
      setRowError(null);
    } catch (err) {
      // AC2 / UX_SPEC §6a "maker = verifier": err.message IS the server's own
      // refusal copy, rendered inline at the row (drag-refusals precedent).
      setRowError({ key, message: errorMessage(err, 'Failed to save the model matrix') });
    }
  }, [applyGlobally, draft, matrix, projectId]);

  const catalogOptions = combinedModelOptions(catalogs, providerEntries);

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
    <section aria-label="Models" data-testid="model-matrix-panel">
      <h2>Models</h2>
      <p className="settings__hint">
        Presets: {MODEL_MATRIX_PRESETS.map((p) => PRESET_LABEL[p]).join(' · ')} (applying
        a preset lands with the first-run wizard).
      </p>
      <p className="settings__hint" data-testid="fallback-explainer">
        The fallback chain is the escalation ladder: the first model does the work,
        and each later one is tried only after the gate rejects the previous
        attempt — put the cheap model first. A row with no fallbacks retries on
        the same model.
      </p>
      {/* W10-64: inherited rows are indistinguishable from configured ones and
          editing silently creates a project override — say where they came
          from. Only shown when rows exist. */}
      {matrix.scope === 'global' && matrix.rows.length > 0 && (
        <p className="settings__notice" role="status">
          These rows come from your every-project defaults. Editing one here configures
          this project only.
        </p>
      )}
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
          {matrix.rows.map((row: ModelMatrixRow) => {
            const key = rowKey(row.role, row.taskType);
            // UX_SPEC §6a "every state, written": a row's model is either
            // known-and-routable, missing (no provider serves it anymore),
            // or unroutable (a provider serves it, but that provider is
            // disabled — "a refusal to use, not a reason to hide").
            const servingProviderId = findServingProviderId(
              row.model,
              catalogs,
              providerEntries,
            );
            const servingEntry = providerEntries.find((e) => e.id === servingProviderId);
            const isUnroutable = servingEntry !== undefined && !servingEntry.enabled;
            const isKnown =
              catalogOptions.length === 0 || catalogOptions.includes(row.model);
            return (
              <tr key={key}>
                <td>{row.role}</td>
                <td>{row.taskType}</td>
                <td>
                  {row.model}{' '}
                  {isUnroutable && (
                    <span className="settings__badge settings__badge--warn">
                      unroutable — provider {servingProviderId} is disabled
                    </span>
                  )}
                  {!isUnroutable && !isKnown && (
                    <span className="settings__badge settings__badge--warn">
                      missing from {servingProviderId ?? 'any registered provider'}
                    </span>
                  )}
                  {rowError?.key === key && (
                    <p role="alert" className="settings__error">
                      {rowError.message}
                    </p>
                  )}
                </td>
                <td data-testid={`fallback-${key}`}>
                  {row.fallback.map((model, index) => (
                    <span key={`${model}-${index}`} className="settings__badge">
                      {model}{' '}
                      <button
                        type="button"
                        aria-label={`Remove fallback ${model} from ${row.role}`}
                        onClick={() =>
                          void saveRowFallback(
                            row,
                            row.fallback.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    aria-label={`Add fallback model for ${row.role} (${row.taskType})`}
                    placeholder="provider/model"
                    value={fallbackDraft.key === key ? fallbackDraft.value : ''}
                    onChange={(e) => setFallbackDraft({ key, value: e.target.value })}
                  />
                  <button
                    type="button"
                    disabled={fallbackDraft.key !== key || !fallbackDraft.value.trim()}
                    onClick={() => {
                      void saveRowFallback(row, [
                        ...row.fallback,
                        fallbackDraft.value.trim(),
                      ]);
                      setFallbackDraft({ key: '', value: '' });
                    }}
                  >
                    Add fallback
                  </button>
                </td>
                <td>
                  <MatrixFitnessCell
                    role={row.role}
                    taskType={row.taskType}
                    state={benchState[rowKey(row.role, row.taskType)]}
                    onBench={() => void runBench(row.role, row.taskType)}
                  />
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
            );
          })}
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
          <select
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            disabled={catalogOptions.length === 0}
          >
            <option value="" disabled>
              {/* W18-06: providers live on their own tab, not "above" — and
                  when one is already registered untested, name it. */}
              {catalogOptions.length === 0
                ? providerEntries.length > 0
                  ? `No models discovered yet — test the ${providerEntries[0]!.id} provider on the Providers tab to discover its models`
                  : 'No models discovered yet — register and test a provider on the Providers tab'
                : 'Select a model…'}
            </option>
            {catalogOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {/* A brand-new role/taskType row that a refusal blocks has no
            existing table row to attach to yet — shown here too so the
            refusal is never lost, not just when editing an existing row. */}
        {rowError &&
          !matrix.rows.some((r) => rowKey(r.role, r.taskType) === rowError.key) && (
            <p role="alert" className="settings__error">
              {rowError.message}
            </p>
          )}
        {/* W10-64. Unchecked writes this project only, which is what the
            control did before this ticket existed. Checked writes the preset
            a product created later inherits — "configure the model once"
            (FR-F3), which was false for the model until now. */}
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={applyGlobally}
            onChange={(e) => setApplyGlobally(e.target.checked)}
          />
          Use for every project
        </label>
        <button type="submit">Add / update row</button>
      </form>
    </section>
  );
}
