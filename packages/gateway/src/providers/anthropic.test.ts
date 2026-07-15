import { describe, expect, it } from 'vitest';
import {
  authFailureFixture,
  messageSuccessFixture,
  messageTruncatedFixture,
  modelsListFixture,
  overloadedFixture,
  rateLimitFixture,
  serverErrorFixture,
  streamAbortSse,
  streamOverloadedSse,
  streamSuccessSse,
  streamTruncatedSse,
} from './anthropic-fixtures.js';
import { createAnthropicProvider } from './anthropic.js';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';
import { normalizeUsage, type CostTable } from './usage.js';

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

/** Answers a POST /v1/messages with a raw SSE body (text/event-stream), everything else with the models fixture. */
function fakeStreamFetch(
  sse: string,
  calls: Call[] = [],
): { fetchImpl: typeof fetch; calls: Call[] } {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    if (url.pathname.endsWith('/messages')) {
      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify(modelsListFixture), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const SAMPLE_COST: CostTable = {
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
};

describe('AnthropicProvider — chat() non-streaming', () => {
  it('parses a successful completion into a normalized ChatResponse', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: messageSuccessFixture,
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const response = await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response).toEqual({
      model: 'claude-sonnet-5',
      message: { role: 'assistant', content: 'Hello! How can I help you today?' },
      finishReason: 'stop',
      usage: {
        promptTokens: 12,
        completionTokens: 9,
        totalTokens: 21,
        costUsd: (12 / 1_000_000) * 3 + (9 / 1_000_000) * 15,
      },
    });
    expect(calls[0]?.headers['x-api-key']).toBe('sk-ant-test');
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('sends system messages via the top-level `system` field, never inside messages', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: messageSuccessFixture,
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await provider.chat({
      model: 'claude-sonnet-5',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'hi' },
      ],
    });

    const body = calls[0]?.body as { system?: string; messages: unknown[] };
    expect(body.system).toBe('Be terse.');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('defaults max_tokens when the request does not specify one', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: messageSuccessFixture,
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect((calls[0]?.body as { max_tokens: number }).max_tokens).toBe(4096);
  });

  it('surfaces truncation via finishReason "length"', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: messageTruncatedFixture,
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const response = await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'write a long essay' }],
    });
    expect(response.finishReason).toBe('length');
    expect(response.usage.totalTokens).toBe(500);
  });

  it('throws ProviderAuthError on 401', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: authFailureFixture.status,
      statusText: authFailureFixture.statusText,
      body: JSON.parse(authFailureFixture.body),
    }));
    const provider = createAnthropicProvider({
      apiKey: 'bad-key',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('throws ProviderRateLimitError on 429 and parses Retry-After', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: rateLimitFixture.status,
      statusText: rateLimitFixture.statusText,
      body: JSON.parse(rateLimitFixture.body),
      headers: { 'retry-after': rateLimitFixture.retryAfterHeader },
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as InstanceType<typeof ProviderRateLimitError>).retryAfterMs).toBe(2000);
  });

  it('throws ProviderRateLimitError on 529 (overloaded — same back-off contract as rate limit)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: overloadedFixture.status,
      statusText: overloadedFixture.statusText,
      body: JSON.parse(overloadedFixture.body),
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
  });

  it('throws the base ProviderHttpError on an unclassified 5xx', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: serverErrorFixture.status,
      statusText: serverErrorFixture.statusText,
      body: JSON.parse(serverErrorFixture.body),
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).not.toBeInstanceOf(ProviderAuthError);
    expect(err).not.toBeInstanceOf(ProviderRateLimitError);
  });

  it('throws ProviderResponseShapeError when usage is missing — never meters as zero silently', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: { ...messageSuccessFixture, usage: {} },
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('throws ProviderResponseShapeError when content is not an array', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: { ...messageSuccessFixture, content: undefined },
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
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

    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: neverRespondsUntilAborted,
      costTable: SAMPLE_COST,
      requestTimeoutMs: 5,
      healthTimeoutMs: 5,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderTimeoutError);
  });

  it('throws ProviderUnreachableError when the endpoint cannot be reached', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderUnreachableError);
  });
});

describe('AnthropicProvider — chat() streaming', () => {
  it('aggregates SSE deltas into the same normalized ChatResponse as the non-streaming path', async () => {
    const { fetchImpl, calls } = fakeStreamFetch(streamSuccessSse);
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response).toEqual({
      model: 'claude-sonnet-5',
      message: { role: 'assistant', content: 'Hello!' },
      finishReason: 'stop',
      usage: {
        promptTokens: 25,
        completionTokens: 15,
        totalTokens: 40,
        costUsd: (25 / 1_000_000) * 3 + (15 / 1_000_000) * 15,
      },
    });
    expect((calls[0]?.body as { stream: boolean }).stream).toBe(true);
  });

  it('surfaces truncation via finishReason "length" over the streaming path', async () => {
    const { fetchImpl } = fakeStreamFetch(streamTruncatedSse);
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'write a long essay' }],
    });
    expect(response.finishReason).toBe('length');
    expect(response.message.content).toBe('This response was cut off mid-');
    expect(response.usage.totalTokens).toBe(500);
  });

  it('throws ProviderRateLimitError on a mid-stream overloaded_error event', async () => {
    const { fetchImpl } = fakeStreamFetch(streamOverloadedSse);
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const err = await provider
      .chat({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
  });

  it('never fabricates a stop_reason for a dropped connection (stream-abort)', async () => {
    const { fetchImpl } = fakeStreamFetch(streamAbortSse);
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.message.content).toBe('Partial resp');
    expect(response.finishReason).toBe('unknown');
  });

  it('throws ProviderResponseShapeError when the stream closes before any usage arrives', async () => {
    const fetchImpl = (async () =>
      new Response('', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch;
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    await expect(
      provider.chat({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('reassembles a data line split across multiple stream chunks', async () => {
    // Split the fixture mid-event so a single SSE record spans two reader.read() results.
    const splitPoint = streamSuccessSse.indexOf(
      '"delta":{"type":"text_delta","text":"Hello"',
    );
    const part1 = streamSuccessSse.slice(0, splitPoint);
    const part2 = streamSuccessSse.slice(splitPoint);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.close();
      },
    });
    const fetchImpl = (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch;
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.message.content).toBe('Hello!');
  });
});

describe('AnthropicProvider — chatStream()', () => {
  async function collect(
    stream: AsyncIterable<import('../types.js').ChatStreamEvent>,
  ): Promise<{ deltas: string[]; final: import('./types.js').ChatResponse | undefined }> {
    const deltas: string[] = [];
    let final: import('./types.js').ChatResponse | undefined;
    for await (const event of stream) {
      if (event.type === 'delta') deltas.push(event.content);
      else final = event.response;
    }
    return { deltas, final };
  }

  it('yields delta events for every text_delta and a final event identical to chat()', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: fakeStreamFetch(streamSuccessSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { deltas, final } = await collect(
      provider.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(deltas).toEqual(['Hello', '!']);
    expect(final).toEqual({
      model: 'claude-sonnet-5',
      message: { role: 'assistant', content: 'Hello!' },
      finishReason: 'stop',
      usage: {
        promptTokens: 25,
        completionTokens: 15,
        totalTokens: 40,
        costUsd: (25 / 1_000_000) * 3 + (15 / 1_000_000) * 15,
      },
    });
  });

  it('usage metering uses the same cost-table formula as the non-streaming path (no unmetered streamed call)', async () => {
    const streaming = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: fakeStreamFetch(streamSuccessSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { final } = await collect(
      streaming.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(final?.usage).toEqual(
      normalizeUsage(
        { promptTokens: 25, completionTokens: 15 },
        'claude-sonnet-5',
        SAMPLE_COST,
      ),
    );
    expect(final?.usage.costUsd).toBeGreaterThan(0);
  });

  it('never fabricates a stop_reason for a dropped connection (stream-abort)', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: fakeStreamFetch(streamAbortSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { deltas, final } = await collect(
      provider.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(deltas.join('')).toBe('Partial resp');
    expect(final?.finishReason).toBe('unknown');
  });

  it('throws ProviderRateLimitError on a mid-stream overloaded_error event', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: fakeStreamFetch(streamOverloadedSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const err = await collect(
      provider.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
  });

  it('reassembles a data line split across multiple stream chunks', async () => {
    const splitPoint = streamSuccessSse.indexOf(
      '"delta":{"type":"text_delta","text":"Hello"',
    );
    const part1 = streamSuccessSse.slice(0, splitPoint);
    const part2 = streamSuccessSse.slice(splitPoint);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.close();
      },
    });
    const fetchImpl = (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch;
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { final } = await collect(
      provider.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(final?.message.content).toBe('Hello!');
  });

  it('honors the concurrency queue — a second chatStream() call queues until the first completes', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      if (callCount === 1) await gate;
      return new Response(streamSuccessSse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      concurrency: 1,
    });

    const first = collect(
      provider.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    await Promise.resolve();
    expect(provider.queueStats().active).toBe(1);
    const second = collect(
      provider.chatStream!({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    await Promise.resolve();
    expect(provider.queueStats().queued).toBe(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 1 });
  });
});

describe('AnthropicProvider — discovery, context length, health, warm-up', () => {
  it('listModels() normalizes the fixture using max_input_tokens as contextLength', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const models = await provider.listModels();
    expect(models).toEqual([
      { id: 'claude-sonnet-5', contextLength: 200_000 },
      { id: 'claude-haiku-4-5-20251001', contextLength: 200_000 },
    ]);
  });

  it('getContextLength() prefers a static override, then falls back to live discovery', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: modelsListFixture,
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      contextLengths: { 'claude-sonnet-5': 8192 },
    });

    await expect(provider.getContextLength('claude-sonnet-5')).resolves.toBe(8192);
    expect(calls).toHaveLength(0);

    await expect(provider.getContextLength('claude-haiku-4-5-20251001')).resolves.toBe(
      200_000,
    );
    await expect(provider.getContextLength('unknown-model')).resolves.toBeUndefined();
  });

  it('health() reports ok on a reachable endpoint', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const health = await provider.health();
    expect(health.status).toBe('ok');
    expect(typeof health.latencyMs).toBe('number');
  });

  it('health() reports unreachable when fetch itself fails', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const health = await provider.health();
    expect(health.status).toBe('unreachable');
  });

  it('health() reports error on a non-2xx response', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: serverErrorFixture.status,
      statusText: serverErrorFixture.statusText,
      body: JSON.parse(serverErrorFixture.body),
    }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const health = await provider.health();
    expect(health.status).toBe('error');
  });

  it('warmUp() reports the endpoint health', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: modelsListFixture }));
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const health = await provider.warmUp();
    expect(health.status).toBe('ok');
  });

  it('queueStats() reflects concurrency configuration', () => {
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      costTable: SAMPLE_COST,
      concurrency: 2,
    });
    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 2 });
  });
});

describe('factory', () => {
  it('createAnthropicProvider defaults id to "anthropic" and baseUrl to api.anthropic.com', async () => {
    const calls: Call[] = [];
    const { fetchImpl } = fakeFetch(
      () => ({ status: 200, body: modelsListFixture }),
      calls,
    );
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });
    expect(provider.id).toBe('anthropic');

    await provider.listModels();
    expect(calls[0]?.path).toBe('/v1/models');
  });
});
