import { useCallback, useEffect, useState } from 'react';
import {
  disableCopilotConsent,
  enableCopilotConsent,
  fetchCopilotConsent,
} from './api-rules.js';
import { SettingsApiError } from './api-client.js';
import type { CopilotConsent } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

export interface CopilotConsentPanelProps {
  projectId: string;
}

/** Copilot provider onboarding, default-off behind the D-019 consent gate (AC6): plain-language account-risk warning, explicit acknowledgement minted as a ledgered event (FR-G6 ack pattern). */
export function CopilotConsentPanel({ projectId }: CopilotConsentPanelProps) {
  const [consent, setConsent] = useState<CopilotConsent | null>(null);
  const [acknowledgedAt, setAcknowledgedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConsent(await fetchCopilotConsent(projectId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load Copilot consent status'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleEnable = useCallback(async () => {
    try {
      const result = await enableCopilotConsent(projectId);
      setAcknowledgedAt(result.acknowledgedAt);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to enable Copilot'));
    }
  }, [projectId, refresh]);

  const handleDisable = useCallback(async () => {
    try {
      await disableCopilotConsent(projectId);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to disable Copilot'));
    }
  }, [projectId, refresh]);

  if (!consent) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  return (
    <section aria-label="Copilot Consent" data-testid="copilot-consent-panel">
      <p
        role="alert"
        className="settings__notice settings__notice--warn"
        data-testid="copilot-warning"
      >
        {consent.warning}
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <p>
        Status:{' '}
        {consent.enabled ? (
          <span className="settings__badge settings__badge--warn">enabled</span>
        ) : (
          <span className="settings__badge settings__badge--muted">
            disabled (default)
          </span>
        )}
      </p>
      {acknowledgedAt && (
        <p className="settings__hint">Acknowledged at {acknowledgedAt}.</p>
      )}
      {consent.enabled ? (
        <button type="button" onClick={() => void handleDisable()}>
          Disable Copilot
        </button>
      ) : (
        <label className="settings__checkbox">
          <input
            type="checkbox"
            data-testid="copilot-acknowledge-checkbox"
            onChange={(e) => {
              if (e.target.checked) void handleEnable();
            }}
          />
          I accept the account-risk warning above and want to enable Copilot for this
          project
        </label>
      )}
    </section>
  );
}
