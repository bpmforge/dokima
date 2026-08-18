import { useState } from 'react';
import { createProject, FleetApiError } from '../fleet/api.js';
import { GuidedSample } from '../onboarding/GuidedSample.js';
import { putGlobalSettings, SettingsApiError } from './api.js';
import {
  authMethodsFor,
  KIND_LABEL,
  hasFixedEndpoint,
  needsProjectScope,
  PROVIDER_KINDS,
  putProviders,
  type ProviderEntry,
  type ProviderKind,
} from './providers-api.js';

/**
 * W10-55: this wizard and the provider REGISTRY have always spelled the same
 * three things differently — `lmstudio`/`openai_compat` here against
 * `lm-studio`/`oai-compat` there. Nothing caught it because the wizard's
 * value was posted to `PUT /settings/global`, which ignores a `providers` key
 * entirely, so the string was never validated by anything. Mapped explicitly
 * rather than renaming the local union, which is what the radio values and
 * their labels are keyed on.
 */
/**
 * W12-19: the kind list and its labels come from `providers-api.ts`, not from
 * a hand-written table here. This file used to carry a `REGISTRY_KIND` map
 * translating three wizard-only names (`lmstudio`, `openai_compat`) into
 * registry kinds — a FOURTH copy of "which provider kinds exist", after the
 * three copies of the adapter dispatch this wave already consolidated
 * (W12-11/15/17). A copy nobody edits is a copy that goes stale, and this one
 * had: it offered three kinds while the Providers panel offered seven.
 */
import { HelpAffordance } from './HelpAffordance.js';
import { MODEL_POLICY_CHOICES } from './modelPolicyChoices.js';

type Step = 'preset' | 'provider' | 'forge' | 'sample' | 'done';

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
  // D-024: NO SILENT DEFAULT. This was `useState('hybrid')`, so a user who
  // clicked straight through opted into cloud spend without ever choosing.
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [providerKind, setProviderKind] = useState<ProviderKind>('lm-studio');
  const [project, setProject] = useState('');
  const [location, setLocation] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:1234/v1');
  const [credentialRef, setCredentialRef] = useState('');
  // D-024 option (b): only the pinned choice needs this, and only on the
  // provider step where the kind is already known.
  const [pinnedModel, setPinnedModel] = useState('');
  const [forgeRef, setForgeRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | undefined>(undefined);
  const [guidedActive, setGuidedActive] = useState(true);

  const savePresetAndProvider = async () => {
    try {
      const chosen = MODEL_POLICY_CHOICES.find((c) => c.id === choiceId);
      if (!chosen) {
        setError('Pick how your work should be modelled before continuing.');
        return;
      }
      // Refused HERE rather than at the first run. A pin with no model is
      // refused by `resolvePolicyScope`, and finding that out when the first
      // build stops is precisely the "option that silently fails" this choice
      // was held back to avoid.
      if (chosen.needsModel && pinnedModel.trim() === '') {
        setError('Name the model to use, exactly as your provider lists it.');
        return;
      }
      await putGlobalSettings({
        defaultModelMatrixPreset: chosen.preset,
        // D-024: the escalation policy is now CHOSEN, not inherited from
        // `resolveLandEscalationPolicy`'s fallback.
        escalationPolicy: chosen.needsModel
          ? {
              mode: chosen.policy,
              model: pinnedModel.trim(),
              // W12-37 infers the convergence ceiling from this (local kinds
              // get 12 attempts, metered 8) and nothing else writes it — omit
              // it and every pin conservatively reads as metered.
              providerKind,
            }
          : { mode: chosen.policy },
        providers: [
          {
            kind: providerKind,
            baseUrl: hasFixedEndpoint(providerKind) ? undefined : baseUrl,
            credentialRef: credentialRef.trim() === '' ? undefined : credentialRef.trim(),
            ...(needsProjectScope(providerKind)
              ? { project: project.trim(), location: location.trim() }
              : {}),
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
            kind: providerKind,
            enabled: true,
            ...(hasFixedEndpoint(providerKind) ? {} : { baseUrl }),
            ...(credentialRef.trim() === '' ? {} : { credentialRef: credentialRef.trim() }),
            // W12-19: REQUIRED for vertex since W12-14, and the wizard never
            // collected them — so choosing Vertex here produced a registry
            // refusal ("bills a specific cloud project and requires project")
            // at the one moment a new user is least equipped to debug it.
            ...(needsProjectScope(providerKind)
              ? { project: project.trim(), location: location.trim() }
              : {}),
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
        <section
          aria-label="How should your work be modelled?"
          data-testid="wizard-step-preset"
        >
          <h2>1. How should your work be modelled?</h2>
          <p className="settings__hint">
            Nothing spends money or contacts a network until you choose. Whichever
            you pick, reviews still use a different model from the one that did
            the work — nothing here checks its own output.
          </p>
          {MODEL_POLICY_CHOICES.map((c) => (
            <label key={c.id} className="settings__radio">
              <input
                type="radio"
                name="model-policy"
                checked={choiceId === c.id}
                onChange={() => setChoiceId(c.id)}
              />
              <span>
                {c.label}
                {c.offlineCapable ? ' (works offline)' : ''}
                <br />
                <small>{c.detail}</small>
              </span>
            </label>
          ))}
          <button
            type="button"
            className="btn-primary"
            disabled={choiceId === null}
            onClick={() => setStep('provider')}
          >
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
              onChange={(e) => setProviderKind(e.target.value as ProviderKind)}
            >
              {PROVIDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {!hasFixedEndpoint(providerKind) && (
            <label>
              Base URL
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}
          {MODEL_POLICY_CHOICES.find((c) => c.id === choiceId)?.needsModel === true && (
            <label>
              Model to use
              <input
                value={pinnedModel}
                onChange={(e) => setPinnedModel(e.target.value)}
                placeholder="qwen3-32b"
              />
              <small className="settings__hint">
                Typed, not chosen from a list: the model catalog is read from a
                provider that is already registered, and at first run there is
                not one yet. Use the id exactly as your provider lists it.
              </small>
            </label>
          )}
          {needsProjectScope(providerKind) && (
            <>
              <label>
                GCP project
                <input
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="my-gcp-project"
                />
              </label>
              <label>
                Region
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="us-central1"
                />
              </label>
            </>
          )}
          {authMethodsFor(providerKind).includes('subscription') ? (
            <p className="settings__hint" data-testid="wizard-subscription-kind">
              {KIND_LABEL[providerKind]} signs in to a subscription rather than
              taking a key. That flow is not wired yet (W12-26) — finish this one
              in Settings → Providers, or pick another kind to get started.
            </p>
          ) : (
            authMethodsFor(providerKind).includes('none') === false && (
              <label>
                Credential ref (keychain name — never a raw secret, FR-S2)
                <input
                  value={credentialRef}
                  onChange={(e) => setCredentialRef(e.target.value)}
                />
              </label>
            )
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
