import {
  authMethodsFor,
  hasFixedEndpoint,
  KIND_LABEL,
  needsProjectScope,
  PROVIDER_KINDS,
  type ProviderKind,
} from './providers-api.js';

/**
 * Step 2 of the setup wizard: where models come from (W12-19, W10-55).
 *
 * Extracted from `FirstRunWizard.tsx` verbatim when W13-37 added the models
 * step and the file crossed the 400-line cap. A move, not a rewrite: the kind
 * list and its labels still come from `providers-api.ts` and not from a table
 * here, which is the property W12-19 established after a wizard-local copy
 * drifted to three kinds while the Providers panel offered seven.
 */
export interface ProviderDraft {
  providerKind: ProviderKind;
  baseUrl: string;
  pinnedModel: string;
  project: string;
  location: string;
  credentialRef: string;
}

export interface WizardProviderStepProps {
  draft: ProviderDraft;
  /** True when step 1's choice pins one model, which is the only case that asks for one. */
  needsModel: boolean;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onNext: () => void;
}

export function WizardProviderStep({
  draft,
  needsModel,
  onChange,
  onNext,
}: WizardProviderStepProps) {
  const { providerKind } = draft;
  return (
    <section aria-label="Register a provider" data-testid="wizard-step-provider">
      <h2>2. Register one provider</h2>
      <label>
        Provider kind
        <select
          value={providerKind}
          onChange={(e) => onChange({ providerKind: e.target.value as ProviderKind })}
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
          <input
            value={draft.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
          />
        </label>
      )}
      {needsModel && (
        <label>
          Model to use
          <input
            value={draft.pinnedModel}
            onChange={(e) => onChange({ pinnedModel: e.target.value })}
            placeholder="the id exactly as your provider lists it"
          />
          <small className="settings__hint">
            Typed, not chosen from a list: the model catalog is read from a provider that
            is already registered, and at first run there is not one yet.
          </small>
        </label>
      )}
      {needsProjectScope(providerKind) && (
        <>
          <label>
            GCP project
            <input
              value={draft.project}
              onChange={(e) => onChange({ project: e.target.value })}
              placeholder="my-gcp-project"
            />
          </label>
          <label>
            Region
            <input
              value={draft.location}
              onChange={(e) => onChange({ location: e.target.value })}
              placeholder="us-central1"
            />
          </label>
        </>
      )}
      {authMethodsFor(providerKind).includes('subscription') ? (
        <p className="settings__hint" data-testid="wizard-subscription-kind">
          {KIND_LABEL[providerKind]} signs in to a subscription rather than taking a key.
          That flow is not wired yet (W12-26) — finish this one in Settings → Providers,
          or pick another kind to get started.
        </p>
      ) : (
        authMethodsFor(providerKind).includes('none') === false && (
          <label>
            Credential ref (keychain name — never a raw secret, FR-S2)
            <input
              value={draft.credentialRef}
              onChange={(e) => onChange({ credentialRef: e.target.value })}
            />
          </label>
        )
      )}
      <button type="button" onClick={onNext}>
        Next
      </button>
    </section>
  );
}
