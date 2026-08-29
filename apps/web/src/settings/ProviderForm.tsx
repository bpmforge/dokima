/**
 * The add/edit-a-provider form (W21-06) — chapter module of ProvidersPanel.
 *
 * Split out when the panel crossed the 400-line cap. It is a controlled form
 * and nothing else: every piece of state lives in the panel, so this file has
 * no opinion about what happens on submit.
 *
 * W21-06 is why it has a title and a hint at all. It used to be a bare row of
 * inputs floating under the providers table with nothing saying what it was
 * for, which read as leftover markup rather than the way you add a provider.
 */
import type { Dispatch, SetStateAction } from 'react';
import { ProviderAuthFields } from './ProviderAuthFields.js';
import { PROVIDER_KINDS, KIND_LABEL, hasFixedEndpoint } from './providers-api.js';
import type { ProviderKind } from './providers-api.js';
import type { Draft } from './ProvidersPanel.js';

export interface ProviderFormProps {
  readonly draft: Draft;
  readonly setDraft: Dispatch<SetStateAction<Draft>>;
  readonly editingId: string | null;
  readonly draftError: string | null;
  readonly applyGlobally: boolean;
  readonly setApplyGlobally: (next: boolean) => void;
  readonly onKindChange: (kind: ProviderKind) => void;
  readonly onSubmit: () => Promise<void> | void;
  readonly onCancelEdit: () => void;
}

export function ProviderForm({
  draft,
  setDraft,
  editingId,
  draftError,
  applyGlobally,
  setApplyGlobally,
  onKindChange,
  onSubmit,
  onCancelEdit,
}: ProviderFormProps) {
  return (
      <form
        className="surface panel"
        aria-label={editingId ? 'Edit provider' : 'Add provider'}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <h3 className="panel__title">
          {editingId ? 'Edit provider' : 'Add a provider'}
        </h3>
        <p className="panel__hint">
          A provider is where models come from — an app running on this machine,
          or an account somewhere else. Adding one makes its models available to
          pick in Models.
        </p>
        <div className="settings__row-form">
        <label>
          Kind
          <select
            value={draft.kind}
            onChange={(e) => onKindChange(e.target.value as ProviderKind)}
          >
            {PROVIDER_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          ID
          <input
            value={draft.id}
            onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
            disabled={editingId !== null}
            placeholder="lm-studio"
          />
        </label>
        {!hasFixedEndpoint(draft.kind) && (
          <label>
            Base URL
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
            />
          </label>
        )}
        <ProviderAuthFields draft={draft} setDraft={setDraft} />
        {/* W22-08. The registry has carried this since W10-57 and the run has
            honoured it since W21-96; until now the only way to set it was a
            PUT with a bearer token. It is the local-only guarantee (C-1,
            D-024 option a), not a convenience — a large model on a laptop
            legitimately needs longer than the default for one generation.

            Deliberately NOT a number input: the browser's spinner invites
            nudging a millisecond value one at a time, and its empty state is
            indistinguishable from a typed 0 in some browsers, which here is
            the difference between "leave it alone" and a value the registry
            refuses. */}
        <label>
          Request timeout (ms)
          <input
            inputMode="numeric"
            value={draft.requestTimeoutMs}
            onChange={(e) =>
              setDraft((d) => ({ ...d, requestTimeoutMs: e.target.value }))
            }
            placeholder="300000"
            aria-describedby="provider-request-timeout-hint"
          />
        </label>
        {/* The hint is a SIBLING tied by aria-describedby, not a child of the
            label. Nested, it became part of the input's accessible name — a
            whole sentence instead of a field name — and three e2e specs went
            red because "mid-answer" contains "id", so `getByLabel('ID')`
            matched two fields. A long hint inside a label is bad for a screen
            reader for the same reason it broke the locator. */}
        <span id="provider-request-timeout-hint" className="settings__hint">
          How long one request may take. Leave empty for the default of five
          minutes. Raise it if a large local model runs past it mid-generation.
        </span>
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
          />
          Enabled
        </label>
        {draftError && (
          <p role="alert" className="settings__error">
            {draftError}
          </p>
        )}
        {/* W10-70. Unchecked registers this project only — what the form did
            before this ticket. Checked registers it for every project, so a
            product created later inherits it (FR-F3). */}
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={applyGlobally}
            onChange={(e) => setApplyGlobally(e.target.checked)}
          />
          Use for every project
        </label>
        <button type="submit">{editingId ? 'Save changes' : 'Add provider'}</button>
        {editingId && (
          <button type="button" onClick={onCancelEdit}>
            Cancel
          </button>
        )}
        </div>
      </form>
  );
}
