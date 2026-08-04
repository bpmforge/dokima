import { useState } from 'react';
import { createProject, FleetApiError } from '../fleet/api.js';
import { GuidedSample } from '../onboarding/GuidedSample.js';
import { putGlobalSettings, SettingsApiError } from './api.js';
import { putProviders, type ProviderEntry, type ProviderKind } from './providers-api.js';

/**
 * W10-55: this wizard and the provider REGISTRY have always spelled the same
 * three things differently — `lmstudio`/`openai_compat` here against
 * `lm-studio`/`oai-compat` there. Nothing caught it because the wizard's
 * value was posted to `PUT /settings/global`, which ignores a `providers` key
 * entirely, so the string was never validated by anything. Mapped explicitly
 * rather than renaming the local union, which is what the radio values and
 * their labels are keyed on.
 */
const REGISTRY_KIND: Record<'lmstudio' | 'openai_compat' | 'vertex', ProviderKind> = {
  lmstudio: 'lm-studio',
  openai_compat: 'oai-compat',
  vertex: 'vertex',
};
import { HelpAffordance } from './HelpAffordance.js';
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

/**
 * First-run wizard (FR-S4, AC1, R-M1): preset -> provider -> forge -> sample
 * -> done. Skipping the forge step is first-class. The wizard's last
 * (`done`) step carries the guided sample walkthrough (BLUEPRINT §12.3,
 * FR-C6): `GuidedSample` drives the real `POST .../pipeline/run` route
 * (wired into `apps/server/src/api/server.ts` by W5-22) for the project
 * just created, then dismisses itself (`guidedActive`) once the walkthrough
 * reaches its own end, leaving the what-to-do-tomorrow card and Done
 * button. Kept as a section on the existing last step rather than a new
 * fifth `Step` so the already-covered `sample -> done` transition
 * (`apps/web/e2e/settings.spec.ts`, out of this ticket's write_scope) keeps
 * passing unchanged — the guided walkthrough is additional content on the
 * last step, not a new gate before it.
 */
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
  const [guidedActive, setGuidedActive] = useState(true);

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
        path: `/tmp/dokima-sample-${Date.now()}`,
        mode: 'new',
        name: 'Dokima Sample',
      });

      // W10-55: THIS is where the provider the user configured in step 2
      // actually gets registered. `savePresetAndProvider` sends it to
      // `PUT /settings/global`, which has never handled a `providers` key —
      // grep `scope-routes.ts` for it and you get nothing — so the entry was
      // silently dropped and every run fell back to the env default
      // (`localhost:1234`). On a machine with LM Studio up that looks like it
      // works; everywhere else "on your configured model" was simply false.
      //
      // Registered at GLOBAL scope (W10-70) rather than onto this project, so
      // it is true for the sample AND for the first real product afterwards —
      // which is what "register once, use everywhere" (FR-F3) promises. It
      // happens here rather than in step 2 because the global-scope write is
      // addressed through a project, and no project exists until now.
      await putProviders(
        card.id,
        [
          {
            id: 'first-run',
            kind: REGISTRY_KIND[providerKind],
            enabled: true,
            ...(providerKind !== 'vertex' ? { baseUrl } : {}),
            ...(providerKind === 'vertex' ? { credentialRef } : {}),
          } as ProviderEntry,
        ],
        { scope: 'global' },
      );

      setCreatedProjectId(card.id);
      setStep('done');
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the sample project'));
    }
  };

  return (
    <div className="settings settings--wizard" data-testid="first-run-wizard">
      <header className="settings__header">
        <h1>
          Setup Wizard <HelpAffordance topic="first-run-wizard" label="Setup wizard" />
        </h1>
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
          <h2>
            4. Guided sample project{' '}
            <HelpAffordance topic="guided-sample" label="Guided sample" />
          </h2>
          <p className="settings__hint">
            Creates a real project, then runs a built-in idea ("a link-shortener with
            auth") through the interview, blueprint, decisions, and board on your
            configured model — watch the whole lifecycle before risking your own idea.
          </p>
          <button type="button" onClick={() => void handleCreateSample()}>
            Create sample project
          </button>
        </section>
      )}

      {step === 'done' && (
        <section aria-label="Wizard complete" data-testid="wizard-step-done">
          <h2>You're set up</h2>

          {createdProjectId && guidedActive && (
            <div data-testid="wizard-guided-sample">
              <GuidedSample
                projectId={createdProjectId}
                onContinue={() => setGuidedActive(false)}
              />
            </div>
          )}

          <div className="settings__hint" data-testid="what-to-do-tomorrow">
            <h3>What to do tomorrow</h3>
            <p>
              Set a role or two to <code>auto</code> and let a ticket run overnight
              (Settings → Autonomy dial). Tomorrow morning, open the notification bell →
              Morning Queue: it sorts by leverage — merges first, then approvals, then
              clarifications — with receipts and cost inline. Budget about ten minutes to
              review a full night's work.
            </p>
          </div>
          <button type="button" onClick={() => onFinish(createdProjectId)}>
            Done
          </button>
        </section>
      )}
    </div>
  );
}
