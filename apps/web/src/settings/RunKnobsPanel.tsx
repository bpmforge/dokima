/**
 * RunKnobsPanel (W17-08): the two knobs the 2026-08-21 live UAT proved
 * matter most, promoted from raw key/value settings a novice would never
 * find — the tool-turn budget (the exact knob every budget park's evidence
 * tells the user to raise) and the Forge Mirror.
 *
 * Law 8 wording is load-bearing on the mirror form: the token field takes
 * the NAME of a vault secret, never the token itself — the server refuses
 * a credential-shaped value without echoing it.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchProjectSettings, putProjectSettings, SettingsApiError } from './api.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

const MAX_TOOL_ITERATIONS_CEILING = 40;

interface ForgeMirrorDraft {
  kind: 'gitea' | 'github';
  baseUrl: string;
  owner: string;
  repo: string;
  makerTokenRef: string;
  makerLogin: string;
}

const EMPTY_MIRROR: ForgeMirrorDraft = {
  kind: 'gitea',
  baseUrl: '',
  owner: '',
  repo: '',
  makerTokenRef: '',
  makerLogin: '',
};

export function RunKnobsPanel({ projectId }: { projectId: string }) {
  const [iterations, setIterations] = useState<string>('');
  const [mirror, setMirror] = useState<ForgeMirrorDraft>(EMPTY_MIRROR);
  const [mirrorConfigured, setMirrorConfigured] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await fetchProjectSettings(projectId);
        const raw = settings.maxToolIterations;
        if (typeof raw === 'number') setIterations(String(raw));
        const forge = settings.forgeMirror as Partial<ForgeMirrorDraft> | undefined;
        if (forge && typeof forge === 'object') {
          setMirror({ ...EMPTY_MIRROR, ...forge });
          setMirrorConfigured(true);
        }
      } catch (err) {
        setError(errorMessage(err, 'Failed to load run settings'));
      }
    })();
  }, [projectId]);

  const saveIterations = useCallback(async () => {
    const value = Number(iterations);
    try {
      await putProjectSettings(projectId, {
        maxToolIterations: Number.isFinite(value) && iterations !== '' ? value : null,
      });
      setStatus('Turn budget saved.');
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the turn budget'));
      setStatus(null);
    }
  }, [iterations, projectId]);

  const saveMirror = useCallback(async () => {
    try {
      await putProjectSettings(projectId, {
        forgeMirror: {
          kind: mirror.kind,
          ...(mirror.kind === 'gitea' ? { baseUrl: mirror.baseUrl } : {}),
          owner: mirror.owner,
          repo: mirror.repo,
          makerTokenRef: mirror.makerTokenRef,
          makerLogin: mirror.makerLogin,
        },
      });
      setMirrorConfigured(true);
      setStatus('Forge mirror saved — the next run will mirror ticket activity.');
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the forge mirror'));
      setStatus(null);
    }
  }, [mirror, projectId]);

  const set = (patch: Partial<ForgeMirrorDraft>) =>
    setMirror((current) => ({ ...current, ...patch }));

  return (
    <section aria-label="Runs and forge" data-testid="run-knobs-panel">
      <h2>Runs &amp; Forge</h2>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="settings__notice">
          {status}
        </p>
      )}

      <h3>Tool-turn budget</h3>
      <p className="settings__hint" data-testid="turn-budget-hint">
        How many tool turns one agent session starts with. Sessions making real progress
        earn more on their own, up to the hard cap of {MAX_TOOL_ITERATIONS_CEILING} — the
        cap exists so a session can never loop forever. Raise the start for chatty local
        models; a budget park's evidence names this exact setting.
      </p>
      {/* W18-05: the shared row-form aligns label-over-input with the button
          at the end — the bare markup left the input orphaned under its label. */}
      <div className="settings__row-form">
        <label>
          Starting turns
          <input
            type="number"
            min={1}
            max={MAX_TOOL_ITERATIONS_CEILING}
            value={iterations}
            placeholder="12 (default)"
            data-testid="turn-budget-input"
            onChange={(e) => setIterations(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => void saveIterations()}>
          Save turn budget
        </button>
      </div>

      <h3>Forge mirror</h3>
      <p className="settings__hint" data-testid="forge-mirror-hint">
        Mirror every ticket&apos;s lifecycle to a Gitea or GitHub repo — claims, evidence,
        and closes with their receipts. Offline writes queue and send when the forge is
        reachable again. The token field takes the NAME of a secret in this project&apos;s
        vault — never paste the token itself.
      </p>
      {mirrorConfigured && (
        <p role="status" className="settings__notice">
          A mirror is configured for this project.
        </p>
      )}
      <div className="settings__row-form">
        <label>
          Forge
          <select
            value={mirror.kind}
            data-testid="forge-kind"
            onChange={(e) => set({ kind: e.target.value as ForgeMirrorDraft['kind'] })}
          >
            <option value="gitea">Gitea</option>
            <option value="github">GitHub</option>
          </select>
        </label>
        {mirror.kind === 'gitea' && (
          <label>
            Gitea URL
            <input
              value={mirror.baseUrl}
              placeholder="https://git.example.com"
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
        )}
        <label>
          Owner
          <input value={mirror.owner} onChange={(e) => set({ owner: e.target.value })} />
        </label>
        <label>
          Repository
          <input value={mirror.repo} onChange={(e) => set({ repo: e.target.value })} />
        </label>
        <label>
          Token secret name (from this project&apos;s vault)
          <input
            value={mirror.makerTokenRef}
            placeholder="FORGE_MAKER_TOKEN"
            data-testid="forge-token-ref"
            onChange={(e) => set({ makerTokenRef: e.target.value })}
          />
        </label>
        <label>
          Bot account username
          <input
            value={mirror.makerLogin}
            onChange={(e) => set({ makerLogin: e.target.value })}
          />
        </label>
        <button
          type="button"
          data-testid="forge-mirror-save"
          onClick={() => void saveMirror()}
        >
          Save forge mirror
        </button>
      </div>
    </section>
  );
}
