import { useCallback, useEffect, useState } from 'react';
import {
  AGENT_RUNNER_CONFIRM_FIELD,
  fetchEffectiveSettings,
  fetchGlobalSettings,
  fetchProjectSettings,
  putGlobalSettings,
  putProjectSettings,
  SettingsApiError,
} from './api.js';
import { HelpAffordance } from './HelpAffordance.js';
import {
  AGENT_RUNNER_SETTINGS_KEY,
  DEFAULT_AGENT_RUNNER_SETTING,
  EXTERNAL_AGENT_WARNING,
  type AgentRunnerKind,
  type AgentRunnerSetting,
  type EffectiveSettings,
} from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

function isAgentRunnerSetting(value: unknown): value is AgentRunnerSetting {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'built-in' || kind === 'external';
}

export interface AgentRunnerPanelProps {
  projectId: string;
}

/**
 * FR-H6, D-023, W11-04: picks the session runner that actually works the
 * board — Dokima's own built-in agent (default) or a typed-in external CLI
 * (the escape hatch W10-77's `--agent-command` used to be the only way to
 * reach). Same generic key/value settings surface + project/global scope
 * toggle shape as the provider registry (W10-70, `ProvidersPanel.tsx`).
 */
export function AgentRunnerPanel({ projectId }: AgentRunnerPanelProps) {
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AgentRunnerKind>('built-in');
  const [command, setCommand] = useState('');
  // Off by default — a global write is the wider blast radius (same posture
  // ProvidersPanel's "Use for every project" toggle takes).
  const [applyGlobally, setApplyGlobally] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const settings = await fetchEffectiveSettings(projectId);
      setEffective(settings);
      const stored = settings[AGENT_RUNNER_SETTINGS_KEY]?.value;
      const current = isAgentRunnerSetting(stored)
        ? stored
        : DEFAULT_AGENT_RUNNER_SETTING;
      setKind(current.kind);
      setCommand(current.command ?? '');
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the agent runner setting'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (kind === 'external' && command.trim() === '') {
      setError(
        'an external agent requires a command — there is no default to fall back to',
      );
      return;
    }
    const next: AgentRunnerSetting =
      kind === 'external' ? { kind, command: command.trim() } : { kind: 'built-in' };
    // W11-20: picking `external` here, with the warning already on screen, is
    // exactly the deliberate-operator signal the confirmation gate wants — so
    // the flag rides along in the same PUT. `built-in` is never gated.
    const confirmation =
      kind === 'external' ? { [AGENT_RUNNER_CONFIRM_FIELD]: true } : {};
    try {
      if (applyGlobally) {
        const current = await fetchGlobalSettings();
        await putGlobalSettings({
          ...current,
          [AGENT_RUNNER_SETTINGS_KEY]: next,
          ...confirmation,
        });
      } else {
        const current = await fetchProjectSettings(projectId);
        await putProjectSettings(projectId, {
          ...current,
          [AGENT_RUNNER_SETTINGS_KEY]: next,
          ...confirmation,
        });
      }
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the agent runner setting'));
    }
  }, [applyGlobally, command, kind, projectId, refresh]);

  if (!effective) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  const effectiveEntry = effective[AGENT_RUNNER_SETTINGS_KEY];

  return (
    <section aria-label="Agent" data-testid="agent-runner-panel">
      <p className="settings__hint">
        Which session runner works the board. <code>built-in</code> (default) is
        Dokima&apos;s own gateway-backed agent (D-023) — the role→model matrix, the
        escalation ladder, the budget breakers, and the spend ledger all apply.{' '}
        <code>external</code> is a typed-in agent CLI you already trust.
        <HelpAffordance topic="settings-agent-runner" label="Agent runner" />
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <p data-testid="agent-runner-current">
        Currently: <strong>{kind}</strong>
        {kind === 'external' && command && (
          <>
            {' '}
            (<code>{command}</code>)
          </>
        )}
      </p>
      {effectiveEntry && (
        <p className="settings__hint" data-testid="agent-runner-effective-scope">
          Effective winning scope for <code>{AGENT_RUNNER_SETTINGS_KEY}</code>:{' '}
          {effectiveEntry.winningScope}
        </p>
      )}

      <form
        className="settings__row-form"
        aria-label="Set agent runner"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <label>
          Runner
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentRunnerKind)}
          >
            <option value="built-in">Built-in (Dokima&apos;s own agent)</option>
            <option value="external">External CLI</option>
          </select>
        </label>
        {kind === 'external' && (
          <>
            <label>
              Command
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="opencode -p"
              />
            </label>
            <p
              role="alert"
              className="settings__notice settings__notice--warn"
              data-testid="external-agent-warning"
            >
              {EXTERNAL_AGENT_WARNING}
            </p>
          </>
        )}
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={applyGlobally}
            onChange={(e) => setApplyGlobally(e.target.checked)}
          />
          Use for every project
        </label>
        <button type="submit">Save agent runner</button>
      </form>
    </section>
  );
}
