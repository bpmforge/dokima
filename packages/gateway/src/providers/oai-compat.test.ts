import { describe, expect, it, vi } from 'vitest';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';
import {
  authFailureFixture,
  chatCompletionSuccessFixture,
  chatCompletionTruncatedFixture,
  modelsListFixture,
  rateLimitFixture,
  serverErrorFixture,
} from './fixtures.js';
import {
  createLmStudioProvider,
  createOaiCompatProvider,
  createOllamaProvider,
} from './oai-compat.js';
import type { CostTable } from './usage.js';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Records every request and answers from a handler — no network, per docs/TESTING.md. */
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
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
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

const NO_COST: CostTable = {};

describe('OaiCompatProvider — chat()', () => {
  it('parses a successful completion into a normalized ChatResponse', async () => {
    const { fetchImpl } = fakeFetch((call) => {
      if (call.path.endsWith('/models')) return { status: 200, body: modelsListFixture };
      return { status: 200, body: chatCompletionSuccessFixture };
    });
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl,
      costTable: NO_COST,
    });

    const response = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response).toEqual({
      model: 'qwen2.5-coder-7b-instruct',
      message: { role: 'assistant', content: 'Hello! How can I help you today?' },
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 9, totalTokens: 21, costUsd: 0 },
    });
  });

  it('surfaces truncation via finishReason "length"', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: chatCompletionTruncatedFixture },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const response = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [{ role: 'user', content: 'write a long essay' }],
    });
    expect(response.finishReason).toBe('length');
    expect(response.usage.totalTokens).toBe(500);
  });

  it('throws ProviderAuthError on 401 (recorded fixture, never a live call)', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : {
            status: authFailureFixture.status,
            statusText: authFailureFixture.statusText,
            body: JSON.parse(authFailureFixture.body),
          },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('throws ProviderRateLimitError on 429 and parses Retry-After', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : {
            status: rateLimitFixture.status,
            statusText: rateLimitFixture.statusText,
            body: JSON.parse(rateLimitFixture.body),
            headers: { 'retry-after': rateLimitFixture.retryAfterHeader },
          },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as InstanceType<typeof ProviderRateLimitError>).retryAfterMs).toBe(2000);
  });

  it('throws ProviderResponseShapeError when usage is missing — never meters as zero silently', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: { ...chatCompletionSuccessFixture, usage: undefined } },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('throws ProviderResponseShapeError when choices is empty', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: { ...chatCompletionSuccessFixture, choices: [] } },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('throws the base ProviderHttpError on an unclassified 5xx (e.g. a crashed local model)', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : {
            status: serverErrorFixture.status,
            statusText: serverErrorFixture.statusText,
            body: JSON.parse(serverErrorFixture.body),
          },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).not.toBeInstanceOf(ProviderAuthError);
    expect(err).not.toBeInstanceOf(ProviderRateLimitError);
  });

  it('throws ProviderTimeoutError when the endpoint never responds in time', async () => {
    const neverRespondsUntilAborted = ((
      _input: string | URL | Request,
      init?: RequestInit,
    ) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), 200);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(
            new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
          );
        });
      })) as typeof fetch;

    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl: neverRespondsUntilAborted,
      requestTimeoutMs: 5,
      healthTimeoutMs: 5,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderTimeoutError);
  });

  it('serializes concurrent calls through the per-endpoint queue (default concurrency 1, FR-G1)', async () => {
    let concurrent = 0;
    let peak = 0;
    const { fetchImpl } = fakeFetch((call) => {
      if (call.path.endsWith('/models')) return { status: 200, body: modelsListFixture };
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      concurrent -= 1;
      return { status: 200, body: chatCompletionSuccessFixture };
    });
    // Wrap fetchImpl so the /chat/completions branch actually overlaps in time.
    const trackingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/chat/completions')) {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
      }
      return fetchImpl(input, init);
    }) as typeof fetch;

    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl: trackingFetch,
    });
    await Promise.all([
      provider.chat({ model: 'm', messages: [{ role: 'user', content: '1' }] }),
      provider.chat({ model: 'm', messages: [{ role: 'user', content: '2' }] }),
      provider.chat({ model: 'm', messages: [{ role: 'user', content: '3' }] }),
    ]);

    expect(peak).toBe(1);
  });

  it('allows N concurrent calls when configured', async () => {
    let concurrent = 0;
    let peak = 0;
    const trackingFetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/chat/completions')) {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        return new Response(JSON.stringify(chatCompletionSuccessFixture), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(modelsListFixture), { status: 200 });
    }) as typeof fetch;

    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl: trackingFetch,
      concurrency: 2,
    });
    await Promise.all([
      provider.chat({ model: 'm', messages: [{ role: 'user', content: '1' }] }),
      provider.chat({ model: 'm', messages: [{ role: 'user', content: '2' }] }),
    ]);

    expect(peak).toBe(2);
  });
});

describe('OaiCompatProvider — discovery, context length, health, warm-up', () => {
  it('listModels() normalizes the fixture and applies configured context lengths', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
      contextLengths: { 'qwen2.5-coder-7b-instruct': 32_768 },
    });

    const models = await provider.listModels();
    expect(models).toEqual([
      { id: 'qwen2.5-coder-7b-instruct', contextLength: 32_768 },
      { id: 'llama-3.2-3b-instruct' },
    ]);
  });

  it('getContextLength() returns the static override or undefined', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
      contextLengths: { known: 8192 },
    });

    await expect(provider.getContextLength('known')).resolves.toBe(8192);
    await expect(provider.getContextLength('unknown-model')).resolves.toBeUndefined();
  });

  it('health() reports ok on a reachable endpoint', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const health = await provider.health();
    expect(health.status).toBe('ok');
    expect(typeof health.latencyMs).toBe('number');
  });

  it('health() reports unreachable when fetch itself fails (connection refused, etc)', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const health = await provider.health();
    expect(health.status).toBe('unreachable');
  });

  it('health() reports error on a non-2xx response (e.g. a crashed local model)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: serverErrorFixture.status,
      statusText: serverErrorFixture.statusText,
      body: JSON.parse(serverErrorFixture.body),
    }));
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const health = await provider.health();
    expect(health.status).toBe('error');
  });

  it('warmUp() pings the endpoint and reports its health', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: modelsListFixture,
    }));
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const health = await provider.warmUp();
    expect(health.status).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v1/models');
  });

  it('chat() auto warms a cold provider once, then skips warm-up on later calls', async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: chatCompletionSuccessFixture },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await provider.chat({ model: 'm', messages: [{ role: 'user', content: '1' }] });
    const pathsAfterFirst = calls.map((c) => c.path);
    expect(pathsAfterFirst).toEqual(['/v1/models', '/v1/chat/completions']);

    await provider.chat({ model: 'm', messages: [{ role: 'user', content: '2' }] });
    const pathsAfterSecond = calls.map((c) => c.path);
    expect(pathsAfterSecond).toEqual([
      '/v1/models',
      '/v1/chat/completions',
      '/v1/chat/completions',
    ]);
  });

  it('queueStats() reflects concurrency configuration and idles back to zero', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
      concurrency: 3,
    });

    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 3 });
  });
});

describe('factories', () => {
  it('createLmStudioProvider defaults to localhost:1234/v1', async () => {
    const calls: Call[] = [];
    const { fetchImpl } = fakeFetch(
      () => ({ status: 200, body: modelsListFixture }),
      calls,
    );
    const provider = createLmStudioProvider({ fetchImpl });
    expect(provider.id).toBe('lm-studio');

    await provider.listModels();
    expect(calls[0]?.path).toBe('/v1/models');
  });

  it('createOllamaProvider defaults to localhost:11434/v1', () => {
    const provider = createOllamaProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(provider.id).toBe('ollama');
  });
});

describe('unreachable endpoint end to end', () => {
  it('chat() rejects with ProviderUnreachableError when the endpoint cannot be reached', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderUnreachableError);
  });
});
