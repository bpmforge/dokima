import { useCallback, useEffect, useState } from 'react';
import { ProviderAuthFields } from './ProviderAuthFields.js';
import {
  buildProviderEntry,
  deleteProvider,
  fetchProviderModels,
  fetchProviders,
  hasFixedEndpoint,
  isHttpUrl,
  isValidProviderId,
  defaultAuthMethod,
  type AuthMethod,
  KIND_LABEL,
  LOCAL_DEFAULT_BASE_URL,
  needsBaseUrl,
  PROVIDER_KINDS,
  putProviders,
  reachability,
  registerCredential,
  removalCopy,
  SettingsApiError,
  type ProviderCatalog,
  type ProviderEntry,
  type ProviderKind,
} from './providers-api.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

interface Draft {
  id: string;
  kind: ProviderKind;
  /** W12-21: HOW this provider is authenticated — chosen, never assumed. */
  authMethod: AuthMethod;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  previousCredentialRef?: string;
}

const EMPTY_DRAFT: Draft = {
  id: '',
  kind: 'ollama',
  authMethod: defaultAuthMethod('ollama'),
  baseUrl: LOCAL_DEFAULT_BASE_URL.ollama,
  apiKey: '',
  enabled: true,
};

export interface ProvidersPanelProps {
  projectId: string;
  /** Lets ModelMatrixPanel build its "select from a LIST" catalog without duplicating the fetch/test flow. */
  onCatalogsChange?: (catalogs: Record<string, ProviderCatalog>) => void;
  /** Paired with `onCatalogsChange` — ModelMatrixPanel needs `enabled` per entry to tell "missing" apart from "unroutable" (UX_SPEC §6a "Provider disabled"). */
  onEntriesChange?: (entries: ProviderEntry[]) => void;
}

/** Provider registry surface (W10-04, FR-G1, D-007, D-019, UX_SPEC §6a): register/edit/test/remove an endpoint and see the models it discovers. */
export function ProvidersPanel({
  projectId,
  onCatalogsChange,
  onEntriesChange,
}: ProvidersPanelProps) {
  const [entries, setEntries] = useState<ProviderEntry[] | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, ProviderCatalog>>({});
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // W10-70: register the provider for every project, not just this one — the
  // other half of "configure once" alongside the model matrix (W10-64). Off by
  // default for the same reason: a global write is the wider blast radius.
  const [applyGlobally, setApplyGlobally] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await fetchProviders(projectId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load providers'));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    onCatalogsChange?.(catalogs);
  }, [catalogs, onCatalogsChange]);

  useEffect(() => {
    if (entries) onEntriesChange?.(entries);
  }, [entries, onEntriesChange]);

  const testProvider = useCallback(
    async (providerId: string) => {
      try {
        const catalog = await fetchProviderModels(projectId, providerId);
        setCatalogs((prev) => ({ ...prev, [providerId]: catalog }));
      } catch (err) {
        setError(errorMessage(err, `Failed to test ${providerId}`));
      }
    },
    [projectId],
  );

  const handleKindChange = (kind: ProviderKind) => {
    const baseUrl =
      kind === 'ollama' || kind === 'lm-studio' ? LOCAL_DEFAULT_BASE_URL[kind] : '';
    // W12-21: the method follows the kind. Leaving a stale method selected
    // would let a user submit an API key for a kind that takes none.
    setDraft((d) => ({ ...d, kind, baseUrl, authMethod: defaultAuthMethod(kind) }));
  };

  const handleEdit = (entry: ProviderEntry) => {
    setEditingId(entry.id);
    setDraftError(null);
    setDraft({
      // An existing entry does not record HOW it was authenticated, so the
      // kind's default is the honest reconstruction rather than a guess from
      // whether a credentialRef happens to be set.
      authMethod: defaultAuthMethod(entry.kind),
      id: entry.id,
      kind: entry.kind,
      baseUrl: entry.baseUrl ?? '',
      apiKey: '',
      enabled: entry.enabled,
      previousCredentialRef: entry.credentialRef,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setDraftError(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSubmit = useCallback(async () => {
    const id = draft.id.trim();
    if (!isValidProviderId(id)) {
      setDraftError('provider id must be lowercase alphanumeric with dashes, 1-64 chars');
      return;
    }
    if (needsBaseUrl(draft.kind) && draft.baseUrl.trim() === '') {
      setDraftError(
        `kind "${draft.kind}" addresses a user-supplied endpoint and requires a base URL`,
      );
      return;
    }
    if (draft.baseUrl.trim() !== '' && !isHttpUrl(draft.baseUrl)) {
      setDraftError('base URL must be a valid http(s) URL');
      return;
    }
    let registeredCredentialRef: string | undefined;
    if (draft.apiKey.trim() !== '') {
      try {
        const { ref } = await registerCredential(
          projectId,
          `${id}-credential`,
          draft.apiKey,
        );
        registeredCredentialRef = ref;
      } catch (err) {
        setDraftError(errorMessage(err, 'Failed to save the API key to the keychain'));
        return;
      }
    }
    const next = buildProviderEntry({
      id,
      kind: draft.kind,
      baseUrl: draft.baseUrl,
      enabled: draft.enabled,
      previousCredentialRef: draft.previousCredentialRef,
      registeredCredentialRef,
    });
    try {
      const saved = await putProviders(
        projectId,
        [...(entries ?? []).filter((e) => e.id !== next.id), next],
        applyGlobally ? { scope: 'global' } : {},
      );
      setEntries(saved);
      setDraftError(null);
      handleCancelEdit();
      void testProvider(next.id);
    } catch (err) {
      setDraftError(errorMessage(err, 'Failed to save the provider'));
    }
  }, [applyGlobally, draft, entries, projectId, testProvider]);

  const handleRemove = useCallback(
    async (entry: ProviderEntry) => {
      if (!window.confirm(removalCopy(entry))) return;
      try {
        await deleteProvider(projectId, entry.id);
        setCatalogs((prev) => {
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
        await refresh();
      } catch (err) {
        setError(errorMessage(err, `Failed to remove ${entry.id}`));
      }
    },
    [projectId, refresh],
  );

  const handleToggle = useCallback(
    async (entry: ProviderEntry) => {
      try {
        const saved = await putProviders(
          projectId,
          (entries ?? []).map((e) =>
            e.id === entry.id ? { ...e, enabled: !e.enabled } : e,
          ),
        );
        setEntries(saved);
      } catch (err) {
        setError(errorMessage(err, `Failed to update ${entry.id}`));
      }
    },
    [entries, projectId],
  );

  if (!entries) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  return (
    <section aria-label="Providers" data-testid="providers-panel">
      <h2>Providers</h2>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      {entries.length === 0 && (
        <p className="settings__hint">
          No providers yet. Dokima runs fully local — point it at Ollama or LM Studio and
          nothing leaves this machine.
        </p>
      )}
      {entries.length > 0 && (
        <table className="settings__table" aria-label="Registered providers">
          <thead>
            <tr>
              <th>Enabled</th>
              <th>ID</th>
              <th>Kind</th>
              <th>Endpoint</th>
              <th>Credential</th>
              <th>Reachability</th>
              <th>Models</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const { chip, detail } = reachability(catalogs[entry.id], entry.kind);
              const badgeClass =
                chip === 'Unreachable'
                  ? 'settings__badge settings__badge--warn'
                  : chip === 'Not tested yet'
                    ? 'settings__badge settings__badge--muted'
                    : 'settings__badge';
              return (
                <tr key={entry.id} style={entry.enabled ? undefined : { opacity: 0.6 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={() => void handleToggle(entry)}
                      aria-label={`Enable ${entry.id}`}
                    />
                  </td>
                  <td>{entry.id}</td>
                  <td>{KIND_LABEL[entry.kind]}</td>
                  <td>{hasFixedEndpoint(entry.kind) ? '—' : (entry.baseUrl ?? '—')}</td>
                  <td>{entry.credentialRef ?? 'none'}</td>
                  <td>
                    <span className={badgeClass}>{chip}</span>
                    {detail && <p className="settings__hint">{detail}</p>}
                  </td>
                  <td>{catalogs[entry.id]?.models.length ?? '—'}</td>
                  <td>
                    <button type="button" onClick={() => void testProvider(entry.id)}>
                      {catalogs[entry.id] ? 'Refresh' : 'Test'}
                    </button>
                    <button type="button" onClick={() => handleEdit(entry)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void handleRemove(entry)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <form
        className="settings__row-form"
        aria-label={editingId ? 'Edit provider' : 'Add provider'}
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <label>
          Kind
          <select
            value={draft.kind}
            onChange={(e) => handleKindChange(e.target.value as ProviderKind)}
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
          <button type="button" onClick={handleCancelEdit}>
            Cancel
          </button>
        )}
      </form>
    </section>
  );
}
