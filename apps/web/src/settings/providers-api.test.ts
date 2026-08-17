import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MODEL_MATRIX_PRESETS } from './types.js';
import {
  buildProviderEntry,
  combinedModelOptions,
  deleteProvider,
  fetchProviderModels,
  fetchProviders,
  findServingProviderId,
  hasFixedEndpoint,
  isHttpUrl,
  isValidProviderId,
  needsBaseUrl,
  putProviders,
  reachability,
  registerCredential,
  removalCopy,
  type ProviderCatalog,
  type ProviderEntry,
  AUTH_METHOD_LABEL,
  authMethodsFor,
  defaultAuthMethod,
  PROVIDER_KINDS,
} from './providers-api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('providers-api wire mapping', () => {
  it('fetchProviders maps snake_case wire entries to camelCase', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        providers: [
          {
            id: 'lm-studio',
            kind: 'oai-compat',
            base_url: 'http://127.0.0.1:1234/v1',
            credential_ref: 'lm-studio-credential',
            enabled: true,
          },
        ],
      }),
    );
    const entries = await fetchProviders('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
      baseUrl: 'http://127.0.0.1:4317',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/providers',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(entries).toEqual([
      {
        id: 'lm-studio',
        kind: 'oai-compat',
        baseUrl: 'http://127.0.0.1:1234/v1',
        credentialRef: 'lm-studio-credential',
        enabled: true,
      },
    ]);
  });

  it('putProviders sends snake_case field names in the request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ providers: [] }));
    const entry: ProviderEntry = {
      id: 'ollama',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      enabled: true,
    };
    await putProviders('proj-1', [entry], { fetchImpl, getToken: () => 'tok' });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      providers: [
        {
          id: 'ollama',
          kind: 'ollama',
          base_url: 'http://localhost:11434/v1',
          enabled: true,
        },
      ],
    });
  });

  it('deleteProvider issues a DELETE to the provider-scoped URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    await deleteProvider('proj-1', 'gone', { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/proj-1/providers/gone'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('fetchProviderModels maps context_length and omits absent optional fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'unreachable',
        source: 'bundled',
        models: [{ id: 'qwen2.5-coder-7b-instruct', context_length: 32768 }],
        reason: 'connect ECONNREFUSED',
      }),
    );
    const catalog = await fetchProviderModels('proj-1', 'ollama', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(catalog).toEqual({
      status: 'unreachable',
      source: 'bundled',
      models: [{ id: 'qwen2.5-coder-7b-instruct', contextLength: 32768 }],
      reason: 'connect ECONNREFUSED',
    });
  });

  it('fetchProviderModels omits reason when absent (the "ok" case)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: 'ok', source: 'discovered', models: [{ id: 'm1' }] }),
      );
    const catalog = await fetchProviderModels('proj-1', 'ollama', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(catalog.reason).toBeUndefined();
    expect(catalog.models).toEqual([{ id: 'm1' }]);
  });

  it('registerCredential POSTs {name, value} and returns the ref', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ref: 'lmstudio-key' }));
    const result = await registerCredential('proj-1', 'lmstudio-key', 'sk-fake-secret', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(result).toEqual({ ref: 'lmstudio-key' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/providers/credentials');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'lmstudio-key',
      value: 'sk-fake-secret',
    });
  });
});

describe('pure validation helpers', () => {
  it('isValidProviderId accepts lowercase-alphanumeric-with-dashes, rejects everything else', () => {
    expect(isValidProviderId('lm-studio-1')).toBe(true);
    expect(isValidProviderId('LM-Studio')).toBe(false);
    expect(isValidProviderId('')).toBe(false);
    expect(isValidProviderId('a'.repeat(65))).toBe(false);
  });

  it('isHttpUrl accepts only http(s) URLs', () => {
    expect(isHttpUrl('http://localhost:1234/v1')).toBe(true);
    expect(isHttpUrl('https://api.example.com')).toBe(true);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('needsBaseUrl is true only for oai-compat (UX_SPEC §6a kind table)', () => {
    expect(needsBaseUrl('oai-compat')).toBe(true);
    expect(needsBaseUrl('ollama')).toBe(false);
    expect(needsBaseUrl('anthropic')).toBe(false);
  });

  it('hasFixedEndpoint is true for the cloud/copilot kinds only', () => {
    expect(hasFixedEndpoint('anthropic')).toBe(true);
    expect(hasFixedEndpoint('openai')).toBe(true);
    expect(hasFixedEndpoint('vertex')).toBe(true);
    expect(hasFixedEndpoint('copilot')).toBe(true);
    expect(hasFixedEndpoint('ollama')).toBe(false);
    expect(hasFixedEndpoint('lm-studio')).toBe(false);
    expect(hasFixedEndpoint('oai-compat')).toBe(false);
  });
});

describe('reachability (UX_SPEC §6a "every state, written")', () => {
  it('is "Not tested yet" before any catalog is fetched', () => {
    expect(reachability(undefined, 'ollama')).toEqual({ chip: 'Not tested yet' });
  });

  it('is "Reachable" with no detail when models are present', () => {
    const catalog: ProviderCatalog = {
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'm1' }],
    };
    expect(reachability(catalog, 'oai-compat')).toEqual({ chip: 'Reachable' });
  });

  it('"Discovery returned nothing": Reachable with zero models carries the local pull/load hint only for local kinds', () => {
    const catalog: ProviderCatalog = { status: 'ok', source: 'discovered', models: [] };
    expect(reachability(catalog, 'ollama').detail).toContain('Pull or load a model');
    expect(reachability(catalog, 'oai-compat').detail).not.toContain('Pull or load');
  });

  it('is "Bundled" for an unreachable endpoint with a bundled fallback, "Unreachable" otherwise', () => {
    const bundled: ProviderCatalog = {
      status: 'unreachable',
      source: 'bundled',
      models: [{ id: 'm1' }],
      reason: 'connect ECONNREFUSED',
    };
    const noFallback: ProviderCatalog = {
      status: 'unreachable',
      source: null,
      models: [],
      reason: 'timeout',
    };
    expect(reachability(bundled, 'ollama')).toEqual({
      chip: 'Bundled',
      detail: 'connect ECONNREFUSED',
    });
    expect(reachability(noFallback, 'ollama')).toEqual({
      chip: 'Unreachable',
      detail: 'timeout',
    });
  });
});

describe('removalCopy (UX_SPEC §6a exact removal copy, C-6)', () => {
  it('names the id and the keychain ref it will NOT delete when one exists', () => {
    const entry: ProviderEntry = {
      id: 'gone',
      kind: 'ollama',
      enabled: true,
      credentialRef: 'gone-credential',
    };
    const copy = removalCopy(entry);
    expect(copy).toContain('Remove gone?');
    expect(copy).toContain('does not delete the keychain entry `gone-credential`');
    expect(copy).toContain('append-only (C-6)');
  });

  it('says there is no keychain entry to preserve when the provider never had one', () => {
    const entry: ProviderEntry = { id: 'bare', kind: 'ollama', enabled: true };
    expect(removalCopy(entry)).toContain('has no keychain entry to preserve');
  });
});

describe('combinedModelOptions / findServingProviderId (AC1 "select from a LIST", enabled-only)', () => {
  const CATALOGS: Record<string, ProviderCatalog> = {
    ollama: { status: 'ok', source: 'discovered', models: [{ id: 'qwen2.5-coder-7b' }] },
    'lm-studio': {
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'qwen2.5-coder-7b' }, { id: 'qwen2.5-coder-32b' }],
    },
    'dead-endpoint': { status: 'unreachable', source: null, models: [] },
    'disabled-endpoint': {
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'only-on-disabled' }],
    },
  };
  const ENTRIES: ProviderEntry[] = [
    { id: 'ollama', kind: 'ollama', enabled: true },
    { id: 'lm-studio', kind: 'lm-studio', enabled: true },
    { id: 'dead-endpoint', kind: 'oai-compat', enabled: true },
    { id: 'disabled-endpoint', kind: 'ollama', enabled: false },
  ];

  it('flattens and dedupes model ids across enabled catalogs only, sorted', () => {
    expect(combinedModelOptions(CATALOGS, ENTRIES)).toEqual([
      'qwen2.5-coder-32b',
      'qwen2.5-coder-7b',
    ]);
  });

  it('excludes a disabled provider entirely from the picker list — a refusal to use, not a reason to hide the row', () => {
    expect(combinedModelOptions(CATALOGS, ENTRIES)).not.toContain('only-on-disabled');
  });

  it('returns [] when no catalogs are known yet (no false "missing" before any Test has run)', () => {
    expect(combinedModelOptions({}, [])).toEqual([]);
  });

  it('finds the provider currently serving a model', () => {
    expect(findServingProviderId('qwen2.5-coder-32b', CATALOGS, ENTRIES)).toBe(
      'lm-studio',
    );
  });

  it('returns undefined for a model no registered provider currently serves (the "missing" state)', () => {
    expect(findServingProviderId('gpt-4-turbo', CATALOGS, ENTRIES)).toBeUndefined();
  });

  it('finds a disabled provider serving a model (the "unroutable" state) when no enabled provider serves it', () => {
    expect(findServingProviderId('only-on-disabled', CATALOGS, ENTRIES)).toBe(
      'disabled-endpoint',
    );
  });

  it('prefers an enabled provider over a disabled one when both serve the same model', () => {
    const catalogs: Record<string, ProviderCatalog> = {
      'disabled-a': { status: 'ok', source: 'discovered', models: [{ id: 'shared' }] },
      'enabled-b': { status: 'ok', source: 'discovered', models: [{ id: 'shared' }] },
    };
    const entries: ProviderEntry[] = [
      { id: 'disabled-a', kind: 'ollama', enabled: false },
      { id: 'enabled-b', kind: 'ollama', enabled: true },
    ];
    expect(findServingProviderId('shared', catalogs, entries)).toBe('enabled-b');
  });
});

describe('buildProviderEntry (Law 8 red fixture: a credential field is only ever a ref)', () => {
  it('prefers a freshly registered ref over the previous one', () => {
    const entry = buildProviderEntry({
      id: ' lm-studio ',
      kind: 'oai-compat',
      baseUrl: 'http://127.0.0.1:1234/v1',
      enabled: true,
      previousCredentialRef: 'old-ref',
      registeredCredentialRef: 'new-ref',
    });
    expect(entry.id).toBe('lm-studio');
    expect(entry.credentialRef).toBe('new-ref');
  });

  it('falls back to the previous ref when no new API key was typed this submit', () => {
    const entry = buildProviderEntry({
      id: 'lm-studio',
      kind: 'oai-compat',
      baseUrl: 'http://127.0.0.1:1234/v1',
      enabled: true,
      previousCredentialRef: 'old-ref',
    });
    expect(entry.credentialRef).toBe('old-ref');
  });

  it('omits credentialRef entirely when there is neither a previous nor a new ref', () => {
    const entry = buildProviderEntry({
      id: 'ollama',
      kind: 'ollama',
      baseUrl: '',
      enabled: true,
    });
    expect(entry).not.toHaveProperty('credentialRef');
  });

  it("RED FIXTURE: the only way a credentialRef can carry a raw secret is if the caller passes the secret itself as registeredCredentialRef — registerCredential's resolved {ref} is what ProvidersPanel actually threads through (see ProvidersPanel.test.tsx), never draft.apiKey", () => {
    const SECRET = 'sk-super-secret-abcdefghijklmnop';
    const RESOLVED_REF = 'my-provider-credential';
    const entry = buildProviderEntry({
      id: 'my-provider',
      kind: 'openai',
      baseUrl: '',
      enabled: true,
      registeredCredentialRef: RESOLVED_REF,
    });
    expect(entry.credentialRef).toBe(RESOLVED_REF);
    expect(entry.credentialRef).not.toBe(SECRET);
    expect(JSON.stringify(entry)).not.toContain(SECRET);
  });

  it('omits baseUrl for fixed-endpoint kinds even if one is passed in', () => {
    const entry = buildProviderEntry({
      id: 'anthro',
      kind: 'anthropic',
      baseUrl: 'http://should-be-ignored',
      enabled: true,
    });
    expect(entry).not.toHaveProperty('baseUrl');
  });

  it('includes a trimmed baseUrl for endpoint-carrying kinds', () => {
    const entry = buildProviderEntry({
      id: 'ollama',
      kind: 'ollama',
      baseUrl: '  http://localhost:11434/v1  ',
      enabled: true,
    });
    expect(entry.baseUrl).toBe('http://localhost:11434/v1');
  });
});

/**
 * AC4: fold `settings/types.ts`'s duplicated `MODEL_MATRIX_PRESETS` into
 * gateway's `routing/presets.ts`. apps/web cannot import `@dokima/gateway`
 * as a runtime dependency (ARCHITECTURE §4 — web talks to the server over
 * REST/WS only; `providers-api.ts`'s own header note and `presets.ts:103-116`
 * both say so), so the web copy stays a hand-mirror by construction — the
 * fold that CAN happen is pinning it so it can no longer drift silently,
 * which is what W10-42 already did server-side
 * (`apps/server/.../matrix-routes.test.ts`'s "AC5: MODEL_MATRIX_PRESETS
 * mirror stays pinned to PRESET_NAMES"). This is that same pin, taken at the
 * web layer: a dynamic `file://` import of the gateway package's source
 * (repo precedent: `e2e/fixtures/seed-board-tickets.mjs`,
 * `e2e/fixtures/event-payload-shape.test.ts`) sidesteps the missing
 * dependency path without adding one.
 */
describe('AC4: settings/types.ts MODEL_MATRIX_PRESETS stays pinned to gateway PRESET_NAMES', () => {
  it('equals @dokima/gateway routing/presets.ts PRESET_NAMES', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '../../../..');
    const gatewayPresetsUrl = pathToFileURL(
      path.join(repoRoot, 'packages', 'gateway', 'src', 'routing', 'presets.ts'),
    ).href;
    const { PRESET_NAMES } = (await import(gatewayPresetsUrl)) as {
      PRESET_NAMES: readonly string[];
    };
    expect(MODEL_MATRIX_PRESETS).toEqual(PRESET_NAMES);
  });
});

describe('auth methods (W12-21)', () => {
  it(
    'RED FIXTURE: auth is NOT a boolean. The panel showed one always-on API-key ' +
      'box, so a subscription sign-in had nowhere to live and a local provider ' +
      'was asked for a key it never needs',
    () => {
      expect(authMethodsFor('ollama')).toEqual(['none']);
      expect(authMethodsFor('lm-studio')).toEqual(['none']);
      expect(authMethodsFor('copilot')).toEqual(['subscription']);
      expect(authMethodsFor('vertex')).toEqual(['gcp-adc']);
      expect(authMethodsFor('openai')).toEqual(['api-key']);
    },
  );

  it('a self-hosted endpoint genuinely supports both, so it gets a choice', () => {
    // `api-key` leads deliberately: that field has always been optional for
    // this kind, so leading with `none` would hide it and change behaviour for
    // every existing user pointing an oai-compat entry at a paid host.
    expect(authMethodsFor('oai-compat')).toEqual(['api-key', 'none']);
    expect(authMethodsFor('oai-compat').length).toBeGreaterThan(1);
  });

  it(
    'GUARD: no kind is listed with a method that has no implementation. Anthropic ' +
      'gains `subscription` when W12-22 lands and OpenAI only if W12-23 finds a ' +
      'supported path — an auth option that cannot work is worse than one absent',
    () => {
      expect(authMethodsFor('anthropic')).not.toContain('subscription');
      expect(authMethodsFor('openai')).not.toContain('subscription');
    },
  );

  it('every kind has a default method, and it is one the kind actually supports', () => {
    for (const kind of PROVIDER_KINDS) {
      expect(authMethodsFor(kind)).toContain(defaultAuthMethod(kind));
    }
  });

  it('every method has a label a person can read — no raw enum reaches the UI', () => {
    for (const kind of PROVIDER_KINDS) {
      for (const method of authMethodsFor(kind)) {
        expect(AUTH_METHOD_LABEL[method]).toBeTruthy();
      }
    }
  });
});
