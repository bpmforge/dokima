import { useState } from 'react';
import { createProject, FleetApiError } from '../fleet/api.js';
import { GuidedSample } from '../onboarding/GuidedSample.js';
import { putGlobalSettings, SettingsApiError } from './api.js';
import {
  hasFixedEndpoint,
  needsProjectScope,
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
import { WizardModelsStep } from './WizardModelsStep.js';
import { WizardPresetStep } from './WizardPresetStep.js';
import { WizardProviderStep } from './WizardProviderStep.js';

/**
 * W13-37: `models` is new, and it is the step that made the wizard finish
 * something. Before it, setup collected a preset and a provider and never
 * asked which models to use, so no matrix row was ever written and the first
 * build failed at the endpoint.
 *
 * It sits after `provider` when a project is already open, and after `sample`
 * when there is not one yet — reading the model catalog and writing the
 * matrix are both addressed through a project, so on a genuinely fresh
 * install the step cannot run until the sample project exists.
 */
type Step = 'preset' | 'provider' | 'models' | 'forge' | 'sample' | 'done';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError || err instanceof FleetApiError
    ? err.message
    : fallback;
}

export interface FirstRunWizardProps {
  onFinish: (projectId?: string) => void;
  onCancel: () => void;
  /**
   * The project already in view, when there is one (W13-35). The global-scope
   * registry write is ADDRESSED THROUGH a project, which is why registration
   * used to wait for the sample step — making "Register one provider" register
   * nothing for anyone who declined it.
   */
  projectId?: string | null;
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
export function FirstRunWizard({ onFinish, onCancel, projectId }: FirstRunWizardProps) {
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
  const [matrixWritten, setMatrixWritten] = useState(false);
  // Where the models step returns to, so the same step serves both entry
  // points without either one guessing.
  const [afterModels, setAfterModels] = useState<Step>('forge');

  /**
   * The registry entry, built once (W13-35): step 2 and the sample step both
   * register, and two inline copies would drift — this wizard has already been
   * where a provider shape was spelled differently from the registry's
   * (W10-55). `project`/`location` are required for vertex (W12-19).
   */
  const providerEntry = (): ProviderEntry =>
    ({
      id: 'first-run',
      kind: providerKind,
      enabled: true,
      ...(hasFixedEndpoint(providerKind) ? {} : { baseUrl }),
      ...(credentialRef.trim() === '' ? {} : { credentialRef: credentialRef.trim() }),
      ...(needsProjectScope(providerKind)
        ? { project: project.trim(), location: location.trim() }
        : {}),
    }) as ProviderEntry;

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
      /**
       * W13-35: register HERE when we can. `savePresetAndProvider` above sends
       * the entry inside a `providers` key on `PUT /settings/global`, which
       * that route has never handled — so before this, step 2 collected
       * provider details and dropped them, and the only real registration
       * happened inside "Create sample project".
       */
      if (projectId) {
        await putProviders(projectId, [providerEntry()], { scope: 'global' });
      }
      setError(null);
      setAfterModels('forge');
      setStep(projectId ? 'models' : 'forge');
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
          providerEntry(),
        ],
        { scope: 'global' },
      );

      setCreatedProjectId(card.id);
      // The fresh-install path: this is the first moment a model catalog can
      // be read or a matrix written, so the models step happens HERE rather
      // than being deferred to Settings with a "come back later" note.
      setAfterModels('done');
      setStep(matrixWritten ? 'done' : 'models');
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the sample project'));
    }
  };

  const matrixProjectId = createdProjectId ?? projectId ?? null;
  const chosenPreset =
    MODEL_POLICY_CHOICES.find((c) => c.id === choiceId)?.preset ?? 'hybrid';

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
        <WizardPresetStep
          choiceId={choiceId}
          onChoose={setChoiceId}
          onNext={() => setStep('provider')}
        />
      )}

      {step === 'provider' && (
        <WizardProviderStep
          draft={{ providerKind, baseUrl, pinnedModel, project, location, credentialRef }}
          needsModel={
            MODEL_POLICY_CHOICES.find((c) => c.id === choiceId)?.needsModel === true
          }
          onChange={(patch) => {
            if (patch.providerKind !== undefined) setProviderKind(patch.providerKind);
            if (patch.baseUrl !== undefined) setBaseUrl(patch.baseUrl);
            if (patch.pinnedModel !== undefined) setPinnedModel(patch.pinnedModel);
            if (patch.project !== undefined) setProject(patch.project);
            if (patch.location !== undefined) setLocation(patch.location);
            if (patch.credentialRef !== undefined) setCredentialRef(patch.credentialRef);
          }}
          onNext={() => void savePresetAndProvider()}
        />
      )}

      {step === 'models' && (matrixProjectId ? (
        <WizardModelsStep
          projectId={matrixProjectId}
          providerId="first-run"
          preset={chosenPreset}
          onSaved={() => {
            setMatrixWritten(true);
            setError(null);
            setStep(afterModels);
          }}
        />
      ) : null)}

      {step === 'forge' && (
        <section aria-label="Connect a forge" data-testid="wizard-step-forge">
          <h2>4. Connect a forge (optional)</h2>
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
            5. Guided sample project{' '}
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
              (Settings → Autonomy). Tomorrow morning, open the notification bell →
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
