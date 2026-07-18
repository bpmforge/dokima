import { useCallback, useEffect, useState } from 'react';
import { demoteRule, fetchRules, promoteRule, registerRule } from './api-rules.js';
import { SettingsApiError } from './api-client.js';
import type { RuleState } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

export interface RuleLifecyclePanelProps {
  projectId: string;
}

/** Rule-lifecycle admin surface (D-014, AC3): per-rule state, measured FP rate + window, human-confirmed promotion/demotion with the data shown. */
export function RuleLifecyclePanel({ projectId }: RuleLifecyclePanelProps) {
  const [rules, setRules] = useState<RuleState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRuleId, setNewRuleId] = useState('');

  const refresh = useCallback(async () => {
    try {
      setRules(await fetchRules(projectId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load rules'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRegister = useCallback(async () => {
    if (!newRuleId.trim()) return;
    try {
      await registerRule(projectId, newRuleId.trim());
      setNewRuleId('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to register rule'));
    }
  }, [newRuleId, projectId, refresh]);

  const handlePromote = useCallback(
    async (ruleId: string) => {
      try {
        await promoteRule(projectId, ruleId);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, `Promotion refused for ${ruleId}`));
      }
    },
    [projectId, refresh],
  );

  const handleDemote = useCallback(
    async (ruleId: string) => {
      try {
        await demoteRule(projectId, ruleId);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, `Demotion refused for ${ruleId}`));
      }
    },
    [projectId, refresh],
  );

  if (!rules) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  return (
    <section aria-label="Rule Lifecycle" data-testid="rule-lifecycle-panel">
      <p className="settings__hint">
        proposed → shadow → advisory → gate → deprecated. Promotion into <code>gate</code>{' '}
        is refused below the sample minimum or above the max FP rate, with counts shown.
        LLMs never promote/demote — every transition here is a human-confirmed action
        (FR-RL2).
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <table className="settings__table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>State</th>
            <th>FP rate</th>
            <th>Window</th>
            <th>Demotion flagged</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.ruleId} data-testid="rule-row">
              <td>{rule.ruleId}</td>
              <td>{rule.state}</td>
              <td>{(rule.fpRate * 100).toFixed(1)}%</td>
              <td>
                {rule.fpWindowFps}/{rule.fpWindowFindings}
              </td>
              <td>
                {rule.demotionFlagged ? (
                  <span className="settings__badge settings__badge--warn">flagged</span>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {rule.state !== 'deprecated' && (
                  <button type="button" onClick={() => void handlePromote(rule.ruleId)}>
                    Promote
                  </button>
                )}
                {rule.state !== 'proposed' && (
                  <button type="button" onClick={() => void handleDemote(rule.ruleId)}>
                    Demote
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={6}>No rules tracked yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        className="settings__row-form"
        aria-label="Register rule"
        onSubmit={(e) => {
          e.preventDefault();
          void handleRegister();
        }}
      >
        <label>
          Rule id
          <input
            value={newRuleId}
            onChange={(e) => setNewRuleId(e.target.value)}
            placeholder="R-01"
          />
        </label>
        <button type="submit">Register rule (starts at proposed)</button>
      </form>
    </section>
  );
}
