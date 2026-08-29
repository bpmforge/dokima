import { useCallback, useEffect, useState } from 'react';
import { ArmedButton } from '../lib/ArmedButton.js';
import { ProviderForm } from './ProviderForm.js';
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

export interface Draft {
  id: string;
  kind: ProviderKind;
  project: string;
  location: string;
  /** W12-21: HOW this provider is authenticated — chosen, never assumed. */
  authMethod: AuthMethod;
  baseUrl: string;
  apiKey: string;
  /** W22-08: raw text, because an empty box means "default" and 0 does not. */
  requestTimeoutMs: string;
  enabled: boolean;
  previousCredentialRef?: string;
}

const EMPTY_DRAFT: Draft = {
  id: '',
  kind: 'ollama',
  project: '',
  location: '',
  authMethod: defaultAuthMethod('ollama'),
  baseUrl: LOCAL_DEFAULT_BASE_URL.ollama,
  apiKey: '',
  requestTimeoutMs: '',
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
      // W12-25: an existing vertex entry must show what it was saved with,
      // or editing anything else would silently blank the billed project.
      project: entry.project ?? '',
      location: entry.location ?? '',
      id: entry.id,
      kind: entry.kind,
      baseUrl: entry.baseUrl ?? '',
      apiKey: '',
      // W22-08: an entry saved with a raised ceiling must SHOW it, or the next
      // edit of any other field would silently drop it back to the default —
      // the same way W12-25 had to reconstruct project/location.
      requestTimeoutMs:
        entry.requestTimeoutMs === undefined ? '' : String(entry.requestTimeoutMs),
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
      project: draft.project,
      location: draft.location,
      requestTimeoutMs: draft.requestTimeoutMs,
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

  // W18-01: two-click armed confirm on the button itself — the native
  // dialog it replaced blocked the whole tab.
  const handleRemove = useCallback(
    async (entry: ProviderEntry) => {
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
                    <ArmedButton
                      label="Remove"
                      armedLabel="Really remove? Click again"
                      armedDetail={removalCopy(entry)}
                      testId={`provider-remove-${entry.id}`}
                      onConfirm={() => void handleRemove(entry)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ProviderForm
        draft={draft}
        setDraft={setDraft}
        editingId={editingId}
        draftError={draftError}
        applyGlobally={applyGlobally}
        setApplyGlobally={setApplyGlobally}
        onKindChange={handleKindChange}
        onSubmit={handleSubmit}
        onCancelEdit={handleCancelEdit}
      />
    </section>
  );
}
