import { useCallback, useEffect, useState } from 'react';
import { fetchEffectiveSettings, SettingsApiError } from './api.js';
import type { EffectiveSettings } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

export interface EffectiveSettingsPanelProps {
  projectId: string;
}

/** FR-S1 "why this value" resolution view: every settings key -> winning scope + what each other scope would have said (AC1). */
export function EffectiveSettingsPanel({ projectId }: EffectiveSettingsPanelProps) {
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEffective(await fetchEffectiveSettings(projectId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load effective settings'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!effective) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  const keys = Object.keys(effective).sort();

  return (
    <section aria-label="Effective Settings" data-testid="effective-settings-panel">
      <p className="settings__hint">
        Precedence: run &gt; project &gt; global. Every key below shows which scope is
        actually winning right now.
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      {keys.length === 0 ? (
        <p>No settings have been set at any scope yet.</p>
      ) : (
        <table className="settings__table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Effective value</th>
              <th>Winning scope</th>
              <th>Overridden by</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const entry = effective[key]!;
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    <code>{JSON.stringify(entry.value)}</code>
                  </td>
                  <td>
                    <span className="settings__badge">{entry.winningScope}</span>
                  </td>
                  <td>
                    {entry.overridden.length === 0
                      ? '—'
                      : entry.overridden
                          .map((o) => `${o.scope}: ${JSON.stringify(o.value)}`)
                          .join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
