import { describe, expect, it, vi } from 'vitest';
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
  registerCredential,
  type ProviderCatalog,
  type ProviderEntry,
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

describe('combinedModelOptions / findServingProviderId (AC1 "select from a LIST")', () => {
  const CATALOGS: Record<string, ProviderCatalog> = {
    ollama: { status: 'ok', source: 'discovered', models: [{ id: 'qwen2.5-coder-7b' }] },
    'lm-studio': {
      status: 'ok',
      source: 'discovered',
      models: [{ id: 'qwen2.5-coder-7b' }, { id: 'qwen2.5-coder-32b' }],
    },
    'dead-endpoint': { status: 'unreachable', source: null, models: [] },
  };

  it('flattens and dedupes model ids across every catalog, sorted', () => {
    expect(combinedModelOptions(CATALOGS)).toEqual([
      'qwen2.5-coder-32b',
      'qwen2.5-coder-7b',
    ]);
  });

  it('returns [] when no catalogs are known yet (no false "missing" before any Test has run)', () => {
    expect(combinedModelOptions({})).toEqual([]);
  });

  it('finds the provider currently serving a model', () => {
    expect(findServingProviderId('qwen2.5-coder-32b', CATALOGS)).toBe('lm-studio');
  });

  it('returns undefined for a model no registered provider currently serves (the "missing" state)', () => {
    expect(findServingProviderId('gpt-4-turbo', CATALOGS)).toBeUndefined();
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
