/**
 * settings/ProviderAuthFields.tsx — the fields that follow the chosen auth method.
 *
 * Chapter of ProvidersPanel.tsx, split under the 400-line CODE_BOOK_PROTOCOL
 * cap the moment adding the auth-method model pushed that file to 439 lines.
 * Third accretion catch of this wave (policy.ts and run-build.ts were the
 * others) — all three were several reasonable appends rather than one
 * oversized write, which is the case a per-FILE cap exists for and a per-diff
 * cap cannot see.
 *
 * Why this is a separate concern rather than more panel: the panel owns the
 * LIST and the lifecycle (add/edit/remove/test); this owns "what does this
 * kind need in order to prove who you are", which is the thing W12-21 made
 * first-class. Before it, an API-key box was always visible regardless of
 * kind — so a local provider was asked for a key it never needs and a
 * subscription sign-in had nowhere to appear at all.
 */
import {
  AUTH_METHOD_LABEL,
  authMethodsFor,
  hasFixedEndpoint,
  type AuthMethod,
  type ProviderKind,
} from './providers-api.js';

export interface AuthDraft {
  kind: ProviderKind;
  authMethod: AuthMethod;
  apiKey: string;
  previousCredentialRef?: string;
}

export interface ProviderAuthFieldsProps<D extends AuthDraft> {
  draft: D;
  setDraft: (update: (d: D) => D) => void;
}

export function ProviderAuthFields<D extends AuthDraft>({
  draft,
  setDraft,
}: ProviderAuthFieldsProps<D>) {
  return (
    <>
  {/* W12-21: the method is a choice when a kind supports more than one, and
              the fields below follow it. Previously an API-key box was always
              visible regardless of kind, so a subscription sign-in had nowhere
              to live and a local provider was asked for a key it never needs. */}
          {authMethodsFor(draft.kind).length > 1 && (
            <label>
              Authentication
              <select
                value={draft.authMethod}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, authMethod: e.target.value as AuthMethod }))
                }
              >
                {authMethodsFor(draft.kind).map((m) => (
                  <option key={m} value={m}>
                    {AUTH_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.authMethod === 'api-key' && (
            <label>
              API key {hasFixedEndpoint(draft.kind) ? '' : '(optional)'}
              <input
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
                placeholder={
                  draft.previousCredentialRef ? 'unchanged — leave blank to keep' : ''
                }
              />
            </label>
          )}
          {draft.authMethod === 'none' && (
            <p className="settings__hint">
              {AUTH_METHOD_LABEL.none}. Nothing is stored for this provider.
            </p>
          )}
          {draft.authMethod === 'subscription' && (
            <p className="settings__hint" data-testid="auth-subscription-pending">
              Signing in to a subscription needs a device-code flow the server does
              not expose yet (W12-26). The adapter itself is built and takes a
              credential store rather than a key — this is the sign-in button, not
              the integration.
            </p>
          )}
          {draft.authMethod === 'gcp-adc' && (
            <p className="settings__hint" data-testid="auth-gcp-adc">
              Vertex uses Google Application Default Credentials, not an API key.
              Register a service-account JSON as a credential, or run{' '}
              <code>gcloud auth application-default login</code> on this machine.
              Project and region are set on the entry (W12-25 adds the fields here).
            </p>
          )}
    </>
  );
}
