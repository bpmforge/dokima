import { useCallback, useEffect, useState } from 'react';
import {
  fetchAutonomy,
  fetchBudget,
  fetchProjectSettings,
  putAutonomy,
  putBudget,
  putProjectSettings,
  SettingsApiError,
} from './api.js';
import type { AutonomySetting, AutonomyMode, BudgetSetting } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

export interface AutonomyBudgetPanelProps {
  projectId: string;
}

/** Autonomy dial with the immutable NEVER-AUTO list (AC1), budget panel with 70/85/100 breaker thresholds (AC1), and the berths slider (AC1) — three small project-scope settings grouped in one panel. */
export function AutonomyBudgetPanel({ projectId }: AutonomyBudgetPanelProps) {
  const [autonomy, setAutonomy] = useState<AutonomySetting | null>(null);
  const [budget, setBudget] = useState<BudgetSetting | null>(null);
  const [berths, setBerths] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, b, s] = await Promise.all([
        fetchAutonomy(projectId),
        fetchBudget(projectId),
        fetchProjectSettings(projectId),
      ]);
      setAutonomy(a);
      setBudget(b);
      setBerths(typeof s.berths === 'number' ? s.berths : 1);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load autonomy/budget/berths'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleModeChange = useCallback(
    async (mode: AutonomyMode) => {
      try {
        setAutonomy(await putAutonomy(projectId, mode));
      } catch (err) {
        setError(errorMessage(err, 'Failed to save autonomy mode'));
      }
    },
    [projectId],
  );

  const handleBudgetSubmit = useCallback(
    async (runLimitUsd?: number, projectLimitUsd?: number) => {
      try {
        setBudget(await putBudget(projectId, { runLimitUsd, projectLimitUsd }));
      } catch (err) {
        setError(errorMessage(err, 'Failed to save budget'));
      }
    },
    [projectId],
  );

  const handleBerthsChange = useCallback(
    async (value: number) => {
      setBerths(value);
      try {
        await putProjectSettings(projectId, { berths: value });
      } catch (err) {
        setError(errorMessage(err, 'Failed to save berths'));
      }
    },
    [projectId],
  );

  if (!autonomy || !budget) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  return (
    <div data-testid="autonomy-budget-panel">
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}

      <section aria-label="Autonomy Dial">
        <h2>Autonomy dial</h2>
        <label className="settings__radio">
          <input
            type="radio"
            name="autonomy-mode"
            checked={autonomy.mode === 'interactive'}
            onChange={() => void handleModeChange('interactive')}
          />
          Interactive — every gated pause asks
        </label>
        {/*
          W13-26: this said "Auto — documented defaults taken and ledgered",
          and none of it happened. No run path reads the mode: a gated pause
          opens a clarification that blocks until a person resolves or
          dismisses it, in either mode. A stored setting that changes nothing
          is worse than an absent one, because the user believes they chose.

          Left selectable when already chosen — a project that set it should
          still see its own state — and otherwise disabled, because offering a
          choice with no effect is the thing being fixed.
        */}
        <label className="settings__radio">
          <input
            type="radio"
            name="autonomy-mode"
            checked={autonomy.mode === 'auto'}
            disabled={autonomy.mode !== 'auto'}
            onChange={() => void handleModeChange('auto')}
          />
          Auto — not in effect yet: every gated pause still asks
        </label>
        <p className="settings__hint">
          Unattended defaults are not enforced yet. Until they are, this project
          behaves as Interactive whichever option is selected.
        </p>
        <h3>NEVER-AUTO (always pauses, not editable)</h3>
        <ul className="settings__never-auto" data-testid="never-auto-list">
          {autonomy.neverAuto.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong> — {item.reason}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Budget Panel">
        <h2>Budget</h2>
        <form
          className="settings__row-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const run = form.get('run_limit_usd');
            const project = form.get('project_limit_usd');
            void handleBudgetSubmit(
              run ? Number(run) : undefined,
              project ? Number(project) : undefined,
            );
          }}
        >
          <label>
            Per-run cap (USD)
            <input
              name="run_limit_usd"
              type="number"
              min={0}
              step="0.01"
              defaultValue={budget.runLimitUsd ?? ''}
            />
          </label>
          <label>
            Per-project cap (USD)
            <input
              name="project_limit_usd"
              type="number"
              min={0}
              step="0.01"
              defaultValue={budget.projectLimitUsd ?? ''}
            />
          </label>
          <button type="submit">Save budget</button>
        </form>
        <p className="settings__hint">
          Circuit breakers: warn at {Math.round(budget.breakerThresholds.warn * 100)}%,
          downshift at {Math.round(budget.breakerThresholds.downshift * 100)}%, hard stop
          at {Math.round(budget.breakerThresholds.hardStop * 100)}%.
        </p>
      </section>

      <section aria-label="Berths Slider">
        <h2>Berths</h2>
        <label>
          Default concurrency: {berths} of 8
          <input
            type="range"
            min={1}
            max={8}
            value={berths}
            aria-label="Default berths"
            onChange={(e) => void handleBerthsChange(Number(e.target.value))}
          />
        </label>
      </section>
    </div>
  );
}
