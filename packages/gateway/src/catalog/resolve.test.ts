import { describe, expect, it, vi } from 'vitest';
import { modelsListFixture } from '../providers/fixtures.js';
import { createLmStudioProvider, createOllamaProvider } from '../providers/oai-compat-presets.js';
import type { ModelInfo } from '../providers/types.js';
import { resolveProviderCatalog } from './resolve.js';

/** Answers `/models` with the recorded fixture, no network — per docs/TESTING.md. */
function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname.endsWith('/models')) {
      return new Response(JSON.stringify(modelsListFixture), { status: 200 });
    }
    throw new Error(`unexpected request to ${url.pathname}`);
  }) as typeof fetch;
}

/** Simulates a fully offline endpoint — fetch itself fails, no network. */
function unreachableFetch(): typeof fetch {
  return (() =>
    Promise.reject(new Error('connect ECONNREFUSED'))) as unknown as typeof fetch;
}

describe('resolveProviderCatalog — contract against recorded LM Studio / Ollama /v1/models responses', () => {
  it('createLmStudioProvider(): reachable endpoint returns the fixture models, source discovered', async () => {
    const provider = createLmStudioProvider({ fetchImpl: fakeFetch() });
    const result = await resolveProviderCatalog('lm-studio', 'lm-studio', provider);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('discovered');
    expect(result.models.map((m) => m.id)).toEqual(
      modelsListFixture.data.map((m) => m.id),
    );
    expect(result.reason).toBeUndefined();
  });

  it('createOllamaProvider(): reachable endpoint returns the fixture models, source discovered', async () => {
    const provider = createOllamaProvider({ fetchImpl: fakeFetch() });
    const result = await resolveProviderCatalog('ollama', 'ollama', provider);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('discovered');
    expect(result.models.map((m) => m.id)).toEqual(
      modelsListFixture.data.map((m) => m.id),
    );
  });

  it('createOllamaProvider(): unreachable endpoint falls back to the bundled catalog, still reported unreachable with the reason', async () => {
    const provider = createOllamaProvider({ fetchImpl: unreachableFetch() });
    const result = await resolveProviderCatalog('ollama', 'ollama', provider);
    expect(result.status).toBe('unreachable');
    expect(result.source).toBe('bundled');
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.reason).toContain('ollama');
  });
});

describe('resolveProviderCatalog — RED FIXTURE: unreachable + no bundled entry is honest absence, never fabricated', () => {
  it('unreachable oai-compat endpoint (no bundled catalog for this kind) resolves with an empty list and the reason, not silently', async () => {
    const provider = {
      listModels: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const result = await resolveProviderCatalog('my-endpoint', 'oai-compat', provider);
    expect(result.status).toBe('unreachable');
    expect(result.source).toBeNull();
    expect(result.models).toEqual([]);
    expect(result.reason).toBe('ECONNREFUSED');
  });

  it('never throws — the catalog always resolves even with zero network and no bundled fallback', async () => {
    const provider = { listModels: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(
      resolveProviderCatalog('x', 'oai-compat', provider),
    ).resolves.toBeDefined();
  });
});

describe('resolveProviderCatalog — reachable but empty, distinct from unreachable', () => {
  it('a reachable endpoint serving no models is status ok, not unreachable', async () => {
    const provider = { listModels: vi.fn().mockResolvedValue([] as ModelInfo[]) };
    const result = await resolveProviderCatalog('x', 'ollama', provider);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('discovered');
    expect(result.models).toEqual([]);
    expect(result.reason).toBeUndefined();
  });
});

describe('resolveProviderCatalog — bundled loader injection', () => {
  it('uses the injected loader instead of the real bundled catalog', async () => {
    const provider = { listModels: vi.fn().mockRejectedValue(new Error('down')) };
    const loadBundled = vi.fn().mockReturnValue([{ id: 'injected-model' }]);
    const result = await resolveProviderCatalog(
      'x',
      'custom-kind',
      provider,
      loadBundled,
    );
    expect(loadBundled).toHaveBeenCalledWith('custom-kind');
    expect(result.models).toEqual([{ id: 'injected-model' }]);
    expect(result.source).toBe('bundled');
  });

  it('treats an injected loader returning undefined as no bundled entry', async () => {
    const provider = { listModels: vi.fn().mockRejectedValue(new Error('down')) };
    const loadBundled = vi.fn().mockReturnValue(undefined);
    const result = await resolveProviderCatalog(
      'x',
      'custom-kind',
      provider,
      loadBundled,
    );
    expect(result.models).toEqual([]);
    expect(result.source).toBeNull();
  });

  it('RED FIXTURE: a throwing bundled loader (malformed catalog.v1.json) still resolves, never rejects', async () => {
    const provider = { listModels: vi.fn().mockRejectedValue(new Error('offline')) };
    const loadBundled = vi.fn().mockImplementation(() => {
      throw new Error(
        'invalid bundled model catalog: version must be a non-empty string',
      );
    });

    await expect(
      resolveProviderCatalog('x', 'custom-kind', provider, loadBundled),
    ).resolves.toMatchObject({
      status: 'unreachable',
      source: null,
      models: [],
    });

    const result = await resolveProviderCatalog(
      'x',
      'custom-kind',
      provider,
      loadBundled,
    );
    expect(result.reason).toContain('offline');
    expect(result.reason).toContain('invalid bundled model catalog');
  });
});
