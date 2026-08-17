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
 */import { HelpAffordance } from './HelpAffordance.js';
import {
  type EscalationPolicyMode,
  type ModelMatrixPreset,
} from './types.js';

type Step = 'preset' | 'provider' | 'forge' | 'sample' | 'done';

/**
 * The D-024 choices, in the USER'S terms rather than the internal mode names.
 * Each maps onto machinery that already exists: a model-matrix preset (which
 * models serve which roles, FR-S3) and an escalation policy (whether and how
 * work climbs the R0-R4 ladder, D-018). Those are two different dimensions and
 * the wizard used to ask about only the first, which is why a fresh install
 * silently adopted `ladder` — `resolveLandEscalationPolicy` returns
 * LADDER_POLICY when nothing is set (policy.ts:80).
 *
 * D-024's option (b), "one model I pick", is DELIBERATELY ABSENT: `locked`
 * pins a ladder RUNG, not a model, so there is nothing honest to map it to
 * until W12-12 adds a pinned-model mode. Showing a choice that silently does
 * something else would be worse than showing three.
 */
interface ModelPolicyChoice {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly preset: ModelMatrixPreset;
  readonly policy: EscalationPolicyMode;
  /** True when the choice can be completed with no provider and no network (C-1). */
  readonly offlineCapable: boolean;
}

export const MODEL_POLICY_CHOICES: readonly ModelPolicyChoice[] = [
  {
    id: 'local-only',
    label: 'Local only — never contact a cloud provider',
    detail:
      'Everything runs on models on this machine. No account, no network, no spend. Fully supported: if something needs a cloud model to work, that is a bug.',
    preset: 'all-local',
    policy: 'ladder',
    offlineCapable: true,
  },
  {
    id: 'cheapest-first',
    label: 'Start cheap, escalate when it has to',
    detail:
      'Local or small models do the work; a stronger model is used only when the cheaper one cannot finish. Needs at least one cloud provider configured.',
    preset: 'hybrid',
    policy: 'ladder',
    offlineCapable: false,
  },
  {
    id: 'approval-gated',
    label: 'Escalate only when I approve it',
    detail:
      'Same as above, but moving to a more expensive model waits for you to say yes. Nothing costly happens unattended.',
    preset: 'hybrid',
    policy: 'token-gated',
    offlineCapable: false,
  },
  {
    id: 'always-best',
    label: 'Always use my best cloud model',
    detail:
      'Skip the cheap tiers entirely. Fastest to a good answer, most expensive. Needs a cloud provider configured.',
    preset: 'all-cloud',
    policy: 'ladder',
    offlineCapable: false,
  },
];

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
      await putGlobalSettings({
        defaultModelMatrixPreset: chosen.preset,
        // D-024: the escalation policy is now CHOSEN, not inherited from
        // `resolveLandEscalationPolicy`'s fallback.
        escalationPolicy: { mode: chosen.policy },
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
            Nothing spends money or contacts a network until you choose.
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
