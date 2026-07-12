import { describe, expect, it } from 'vitest';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderUnreachableError,
} from './errors.js';
import type { CostTable } from './usage.js';
import type { VertexAuthClientFactory } from './vertex-auth.js';
import { createVertexProvider, VertexProvider } from './vertex.js';
import {
  authFailureFixture,
  countTokensSuccessFixture,
  generateContentSuccessFixture,
  rateLimitFixture,
  serverErrorFixture,
  tokenSuccessFixture,
} from './vertex-fixtures.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const FIXTURE_TOKEN = tokenSuccessFixture.access_token;

/** Network-free auth: returns the fixture token (auth is exercised in vertex-auth.test.ts). */
const okAuth: VertexAuthClientFactory = () => ({
  getAccessToken: async () => FIXTURE_TOKEN,
});

/** Network-free auth whose token acquisition fails, for the "not configured" health path. */
const failAuth =
  (error: Error): VertexAuthClientFactory =>
  () => ({
    getAccessToken: async () => {
      throw error;
    },
  });

/** Records every Vertex REST call and answers it with `handler`. No network, per docs/TESTING.md. */
function fakeFetch(
  handler: (call: Call) => {
    status: number;
    statusText?: string;
    body: unknown;
    headers?: Record<string, string>;
  },
  calls: Call[] = [],
): { fetchImpl: typeof fetch; calls: Call[] } {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: typeof input === 'string' ? input : input.toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const result = handler(call);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      statusText: result.statusText,
      headers: { 'content-type': 'application/json', ...result.headers },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const SAMPLE_COST: CostTable = {
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
};

const BASE_CONFIG = {
  project: 'fixture-project',
  location: 'us-central1',
  serviceAccountJson: JSON.stringify({
    type: 'service_account',
    client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n',
  }),
  costTable: SAMPLE_COST,
  authClientFactory: okAuth,
};

describe('VertexProvider construction', () => {
  it('requires project and location', () => {
    expect(() => createVertexProvider({ ...BASE_CONFIG, project: '' })).toThrow(
      RangeError,
    );
    expect(() => createVertexProvider({ ...BASE_CONFIG, location: '' })).toThrow(
      RangeError,
    );
  });
});

describe('VertexProvider — chat()', () => {
  it('POSTs generateContent to the region/project/location endpoint with a bearer token', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: generateContentSuccessFixture,
    }));
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });

    const response = await provider.chat({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response).toEqual({
      model: 'gemini-2.5-pro',
      message: { role: 'assistant', content: 'Hello! How can I help you today?' },
      finishReason: 'stop',
      usage: {
        promptTokens: 12,
        completionTokens: 9,
        totalTokens: 21,
        costUsd: (12 / 1_000_000) * 1.25 + (9 / 1_000_000) * 5,
      },
    });

    const chatCall = calls.find((c) => c.url.includes(':generateContent'));
    expect(chatCall?.url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
    );
    expect(chatCall?.headers.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
  });

  it('classifies a 401 as ProviderAuthError', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: authFailureFixture.status,
      statusText: authFailureFixture.statusText,
      body: JSON.parse(authFailureFixture.body),
    }));
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });
    await expect(
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('classifies a 429 as ProviderRateLimitError and parses Retry-After', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: rateLimitFixture.status,
      statusText: rateLimitFixture.statusText,
      body: JSON.parse(rateLimitFixture.body),
      headers: { 'retry-after': rateLimitFixture.retryAfterHeader },
    }));
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });
    const err = await provider
      .chat({ model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as ProviderRateLimitError).retryAfterMs).toBe(2000);
  });

  it('classifies a 500 as a generic ProviderHttpError', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: serverErrorFixture.status,
      statusText: serverErrorFixture.statusText,
      body: JSON.parse(serverErrorFixture.body),
    }));
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });
    await expect(
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(ProviderHttpError);
  });

  it('classifies an unreachable endpoint as ProviderUnreachableError', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });
    await expect(
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(ProviderUnreachableError);
  });

  it('serializes calls through the per-endpoint RequestQueue', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const fetchImpl = (async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return new Response(JSON.stringify(generateContentSuccessFixture), { status: 200 });
    }) as typeof fetch;
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl, concurrency: 1 });

    await Promise.all([
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'a' }],
      }),
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'b' }],
      }),
    ]);

    expect(maxConcurrent).toBe(1);
  });
});

describe('VertexProvider — health()/warmUp()', () => {
  it('reports ok from ADC token acquisition alone when healthCheckModel is unset', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });
    const health = await provider.health();
    expect(health.status).toBe('ok');
    expect(health.detail).toMatch(/ADC token acquired/);
    expect(calls.some((c) => c.url.includes(':countTokens'))).toBe(false);
  });

  it('also probes countTokens when healthCheckModel is configured', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: countTokensSuccessFixture,
    }));
    const provider = new VertexProvider({
      ...BASE_CONFIG,
      fetchImpl,
      healthCheckModel: 'gemini-2.5-flash',
    });
    const health = await provider.health();
    expect(health.status).toBe('ok');
    expect(calls.some((c) => c.url.includes(':countTokens'))).toBe(true);
  });

  it('reports unreachable, not a thrown crash, when the Vertex endpoint cannot be reached', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const provider = new VertexProvider({
      ...BASE_CONFIG,
      fetchImpl,
      healthCheckModel: 'gemini-2.5-flash',
    });
    const health = await provider.health();
    expect(health.status).toBe('unreachable');
  });

  it('reports "not configured" ADC as an error status, never an uncaught crash', async () => {
    const provider = new VertexProvider({
      ...BASE_CONFIG,
      authClientFactory: failAuth(new Error('Could not load the default credentials')),
    });
    const health = await provider.health();
    expect(health.status).toBe('error');
  });

  it('warmUp() delegates to health()', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
    const provider = new VertexProvider({ ...BASE_CONFIG, fetchImpl });
    const health = await provider.warmUp();
    expect(health.status).toBe('ok');
  });
});

describe('VertexProvider — static discovery surface', () => {
  it('listModels()/getContextLength() pass through the configured static catalog', async () => {
    const provider = new VertexProvider({
      ...BASE_CONFIG,
      models: [{ id: 'gemini-2.5-pro', contextLength: 1_048_576 }],
      contextLengths: { 'gemini-2.5-pro': 1_048_576 },
    });
    expect(await provider.listModels()).toEqual([
      { id: 'gemini-2.5-pro', contextLength: 1_048_576 },
    ]);
    expect(await provider.getContextLength('gemini-2.5-pro')).toBe(1_048_576);
    expect(await provider.getContextLength('unknown-model')).toBeUndefined();
  });
});

describe('VertexProvider — queueStats()', () => {
  it('reflects the configured concurrency', () => {
    const provider = new VertexProvider({ ...BASE_CONFIG, concurrency: 2 });
    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 2 });
  });
});
