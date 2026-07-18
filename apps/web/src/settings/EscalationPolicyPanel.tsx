import { useCallback, useEffect, useState } from 'react';
import {
  fetchEffectiveSettings,
  fetchProjectSettings,
  putProjectSettings,
  SettingsApiError,
} from './api.js';
import { HelpAffordance } from './HelpAffordance.js';
import type {
  EffectiveSettings,
  EscalationPolicyMode,
  EscalationPolicySetting,
  PolicyRung,
  TierKind,
} from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

const MODES: EscalationPolicyMode[] = ['ladder', 'locked', 'token-gated'];
const RUNGS: PolicyRung[] = ['R1', 'R2', 'R3'];
const TIER_KINDS: TierKind[] = ['metered', 'local'];

export interface EscalationPolicyPanelProps {
  projectId: string;
}

/** Per-role escalation policy (D-018, AC4): ladder/locked/token-gated tier picker plus the effective-policy "why this value" view; in-product help rendered from content/guide/ (R-M1). */
export function EscalationPolicyPanel({ projectId }: EscalationPolicyPanelProps) {
  const [policies, setPolicies] = useState<Record<
    string,
    EscalationPolicySetting
  > | null>(null);
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('coding-agent');
  const [mode, setMode] = useState<EscalationPolicyMode>('ladder');
  const [pinnedTier, setPinnedTier] = useState<PolicyRung>('R1');
  const [tierKind, setTierKind] = useState<TierKind>('local');
  const [namedTier, setNamedTier] = useState<PolicyRung>('R2');

  const refresh = useCallback(async () => {
    try {
      const [settings, effectiveSettings] = await Promise.all([
        fetchProjectSettings(projectId),
        fetchEffectiveSettings(projectId),
      ]);
      const value = settings.escalationPolicy;
      setPolicies(
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? (value as Record<string, EscalationPolicySetting>)
          : {},
      );
      setEffective(effectiveSettings);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load escalation policy'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!role.trim() || !policies) return;
    const setting: EscalationPolicySetting =
      mode === 'ladder'
        ? { mode }
        : mode === 'locked'
          ? { mode, pinnedTier, tierKind }
          : { mode, namedTier };
    const next = { ...policies, [role.trim()]: setting };
    try {
      await putProjectSettings(projectId, { escalationPolicy: next });
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save escalation policy'));
    }
  }, [mode, namedTier, pinnedTier, policies, projectId, refresh, role, tierKind]);

  if (!policies || !effective) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  const effectiveEntry = effective.escalationPolicy;

  return (
    <section aria-label="Escalation Policy" data-testid="escalation-policy-panel">
      <p className="settings__hint">
        <code>ladder</code> (default, R0-R4 auto) · <code>locked</code> (pinned tier loops
        under the convergence budget) · <code>token-gated</code> (climbing past a named
        tier requires an approval-minted token). NEVER-AUTO stays hard at every tier.
        <HelpAffordance topic="settings-escalation-policy" label="Escalation policy" />
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <table className="settings__table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Mode</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(policies).map(([r, policy]) => (
            <tr key={r} data-testid="escalation-policy-row">
              <td>{r}</td>
              <td>{policy.mode}</td>
              <td>
                {policy.mode === 'locked' &&
                  `pinned ${policy.pinnedTier} (${policy.tierKind})`}
                {policy.mode === 'token-gated' && `gated past ${policy.namedTier}`}
                {policy.mode === 'ladder' && '—'}
              </td>
            </tr>
          ))}
          {Object.keys(policies).length === 0 && (
            <tr>
              <td colSpan={3}>No per-role overrides — every role uses ladder mode.</td>
            </tr>
          )}
        </tbody>
      </table>
      {effectiveEntry && (
        <p className="settings__hint" data-testid="escalation-effective-scope">
          Effective winning scope for <code>escalationPolicy</code>:{' '}
          {effectiveEntry.winningScope}
        </p>
      )}

      <form
        className="settings__row-form"
        aria-label="Set escalation policy"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <label>
          Role
          <input value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        <label>
          Mode
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as EscalationPolicyMode)}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {mode === 'locked' && (
          <>
            <label>
              Pinned tier
              <select
                value={pinnedTier}
                onChange={(e) => setPinnedTier(e.target.value as PolicyRung)}
              >
                {RUNGS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tier kind
              <select
                value={tierKind}
                onChange={(e) => setTierKind(e.target.value as TierKind)}
              >
                {TIER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {mode === 'token-gated' && (
          <label>
            Named tier (token required to climb past)
            <select
              value={namedTier}
              onChange={(e) => setNamedTier(e.target.value as PolicyRung)}
            >
              {RUNGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit">Save policy for role</button>
      </form>
    </section>
  );
}
