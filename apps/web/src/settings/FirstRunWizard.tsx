import { useState } from 'react';
import { createProject, FleetApiError } from '../fleet/api.js';
import { putGlobalSettings, SettingsApiError } from './api.js';
import { MODEL_MATRIX_PRESETS, type ModelMatrixPreset } from './types.js';

type Step = 'preset' | 'provider' | 'forge' | 'sample' | 'done';

const PRESET_LABEL: Record<ModelMatrixPreset, string> = {
  'all-local': 'All-local — point at LM Studio/Ollama, nothing leaves your machine',
  hybrid: 'Hybrid — local for volume, one frontier provider for review/escalation',
  'all-cloud': 'All-cloud — every role on a frontier provider',
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError || err instanceof FleetApiError
    ? err.message
    : fallback;
}

export interface FirstRunWizardProps {
  onFinish: (projectId?: string) => void;
  onCancel: () => void;
}

/** First-run wizard (FR-S4, AC1): preset -> provider -> forge -> sample. Skipping the forge step is first-class. The guided sample program itself (FR-C6) is W5-09's job — this hands off by creating a real project via the already-built Fleet API, honestly, rather than fabricating a walkthrough. */
export function FirstRunWizard({ onFinish, onCancel }: FirstRunWizardProps) {
  const [step, setStep] = useState<Step>('preset');
  const [preset, setPreset] = useState<ModelMatrixPreset>('hybrid');
  const [providerKind, setProviderKind] = useState<
    'lmstudio' | 'openai_compat' | 'vertex'
  >('lmstudio');
  const [baseUrl, setBaseUrl] = useState('http://localhost:1234/v1');
  const [credentialRef, setCredentialRef] = useState('');
  const [forgeRef, setForgeRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | undefined>(undefined);

  const savePresetAndProvider = async () => {
    try {
      await putGlobalSettings({
        defaultModelMatrixPreset: preset,
        providers: [
          {
            kind: providerKind,
            baseUrl: providerKind !== 'vertex' ? baseUrl : undefined,
            credentialRef: providerKind === 'vertex' ? credentialRef : undefined,
          },
        ],
      });
      setError(null);
      setStep('forge');
    } catch (err) {
      setError(errorMessage(err, 'Failed to save preset/provider'));
    }
  };

  const handleCreateSample = async () => {
    try {
      const card = await createProject({
        path: `/tmp/shipwright-sample-${Date.now()}`,
        mode: 'new',
        name: 'Shipwright Sample',
      });
      setCreatedProjectId(card.id);
      setStep('done');
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the sample project'));
    }
  };

  return (
    <div className="settings settings--wizard" data-testid="first-run-wizard">
      <header className="settings__header">
        <h1>Setup Wizard</h1>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </header>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}

      {step === 'preset' && (
        <section aria-label="Pick a preset" data-testid="wizard-step-preset">
          <h2>1. Pick a preset</h2>
          {MODEL_MATRIX_PRESETS.map((p) => (
            <label key={p} className="settings__radio">
              <input
                type="radio"
                name="preset"
                checked={preset === p}
                onChange={() => setPreset(p)}
              />
              {PRESET_LABEL[p]}
            </label>
          ))}
          <button type="button" onClick={() => setStep('provider')}>
            Next
          </button>
        </section>
      )}

      {step === 'provider' && (
        <section aria-label="Register a provider" data-testid="wizard-step-provider">
          <h2>2. Register one provider</h2>
          <label>
            Provider kind
            <select
              value={providerKind}
              onChange={(e) => setProviderKind(e.target.value as typeof providerKind)}
            >
              <option value="lmstudio">LM Studio (local)</option>
              <option value="openai_compat">OpenAI-compatible endpoint</option>
              <option value="vertex">Vertex AI</option>
            </select>
          </label>
          {providerKind !== 'vertex' ? (
            <label>
              Base URL
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          ) : (
            <label>
              Credential ref (keychain name — never a raw secret, FR-S2)
              <input
                value={credentialRef}
                onChange={(e) => setCredentialRef(e.target.value)}
              />
            </label>
          )}
          <button type="button" onClick={() => void savePresetAndProvider()}>
            Next
          </button>
        </section>
      )}

      {step === 'forge' && (
        <section aria-label="Connect a forge" data-testid="wizard-step-forge">
          <h2>3. Connect a forge (optional)</h2>
          <label>
            Forge credential ref (leave blank to skip)
            <input value={forgeRef} onChange={(e) => setForgeRef(e.target.value)} />
          </label>
          <button type="button" onClick={() => setStep('sample')}>
            {forgeRef.trim() ? 'Next' : 'Skip'}
          </button>
        </section>
      )}

      {step === 'sample' && (
        <section aria-label="Guided sample" data-testid="wizard-step-sample">
          <h2>4. Guided sample project</h2>
          <p className="settings__hint">
            Creates a real project via the Fleet API. The guided interview → gates → board
            walkthrough content (FR-C6) lands with a later ticket — this step hands off
            honestly to a real, empty sample project rather than a fake demo.
          </p>
          <button type="button" onClick={() => void handleCreateSample()}>
            Create sample project
          </button>
        </section>
      )}

      {step === 'done' && (
        <section aria-label="Wizard complete" data-testid="wizard-step-done">
          <h2>You're set up</h2>
          <button type="button" onClick={() => onFinish(createdProjectId)}>
            Done
          </button>
        </section>
      )}
    </div>
  );
}
