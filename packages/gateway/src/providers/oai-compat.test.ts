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
import { DEFAULT_REQUEST_TIMEOUT_MS } from './oai-compat-types.js';
import {
  createLmStudioProvider,
  createOaiCompatProvider,
  createOllamaProvider,
} from './oai-compat.js';
import {
  streamNoUsageSse,
  streamSuccessSse,
  streamTruncatedSse,
} from './openai-fixtures.js';
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

/** Answers a POST /chat/completions with a raw SSE body (text/event-stream), everything else with the models fixture. */
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
    if (url.pathname.endsWith('/chat/completions')) {
      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify(modelsListFixture), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const NO_COST: CostTable = {};
const SAMPLE_COST: CostTable = {
  'gpt-5.1': { inputPerMillion: 5, outputPerMillion: 20 },
};

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

  /**
   * W10-57. Driving the real product against LM Studio, the creation pipeline
   * died with `pipeline-run: request timed out after 60000ms`. This is the
   * LOCAL path — LM Studio and Ollama are both OaiCompat variants — and 60s
   * made the product's headline use case unusable.
   *
   * Both directions are asserted on purpose: raising a timeout until nothing
   * ever trips it is not a fix, it is removing the guard.
   */
  it('RED FIXTURE: a response slower than the OLD 60s default now succeeds', async () => {
    // Simulated rather than actually slow: the point is which side of the
    // DEFAULT the request falls on, and a real 61s test would be untestable.
    const slowerThanOldDefault = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify(chatCompletionSuccessFixture), { status: 200 }),
            ),
          10,
        );
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'TimeoutError'));
        });
      })) as typeof fetch;

    // No requestTimeoutMs override — this is the DEFAULT under test.
    const provider = createOaiCompatProvider({
      id: 'local',
      baseUrl: 'http://x/v1',
      fetchImpl: slowerThanOldDefault,
    });
    const res = await provider.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.message.content).toBeTruthy();
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it('still raises ProviderTimeoutError past the NEW default — the guard is raised, not removed', async () => {
    const neverResponds = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        // A late resolve, exactly as the existing timeout test does — without
        // one the promise can hang forever if the abort never lands, and the
        // test fails on the runner's clock instead of on the assertion.
        const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), 200);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'TimeoutError'));
        });
      })) as typeof fetch;

    const provider = createOaiCompatProvider({
      id: 'local',
      baseUrl: 'http://x/v1',
      fetchImpl: neverResponds,
      requestTimeoutMs: 5,
    });
    await expect(
      provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderTimeoutError);
  });

  it('leaves the CLOUD adapters at 60s — they talk to hosted endpoints', async () => {
    // A minute of silence from a hosted API really does mean something is
    // wrong; the local raise must not quietly become a global one.
    const [
      { DEFAULT_REQUEST_TIMEOUT_MS: anthropicDefault },
      { DEFAULT_REQUEST_TIMEOUT_MS: copilotDefault },
    ] = await Promise.all([import('./anthropic-types.js'), import('./copilot-types.js')]);
    expect(anthropicDefault).toBe(60_000);
    expect(copilotDefault).toBe(60_000);
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

/** Inline per FR-G9/W11-01: fixtures.ts and openai-fixtures.ts are outside this ticket's write_scope. */
const toolCallCompletionFixture = {
  id: 'chatcmpl-fixture-tools-001',
  object: 'chat.completion',
  created: 1_752_000_010,
  model: 'qwen2.5-coder-7b-instruct',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
};

const sseChunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

/** A single tool call whose id/name arrive on the first delta, arguments arrive split across two deltas — exactly how real OpenAI-compatible streams fragment tool_calls. */
const toolCallStreamSse =
  sseChunk({
    id: 'chatcmpl-fixture-stream-tools-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_011,
    model: 'gpt-5.1',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_stream_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }) +
  sseChunk({
    id: 'chatcmpl-fixture-stream-tools-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_011,
    model: 'gpt-5.1',
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"location":' } }] },
        finish_reason: null,
      },
    ],
  }) +
  sseChunk({
    id: 'chatcmpl-fixture-stream-tools-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_011,
    model: 'gpt-5.1',
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '"NYC"}' } }] },
        finish_reason: null,
      },
    ],
  }) +
  sseChunk({
    id: 'chatcmpl-fixture-stream-tools-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_011,
    model: 'gpt-5.1',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }) +
  sseChunk({
    id: 'chatcmpl-fixture-stream-tools-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_011,
    model: 'gpt-5.1',
    choices: [],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  }) +
  'data: [DONE]\n\n';

describe('OaiCompatProvider — tool calling (FR-G9, D-023, W11-01)', () => {
  it('RED FIXTURE: serializes request.tools onto the wire in the OpenAI tool-calling shape', async () => {
    const calls: Call[] = [];
    const { fetchImpl } = fakeFetch(
      (call) =>
        call.path.endsWith('/models')
          ? { status: 200, body: modelsListFixture }
          : { status: 200, body: chatCompletionSuccessFixture },
      calls,
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await provider.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'what is the weather in NYC?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Look up current weather for a location',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ],
    });

    const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
    expect((chatCall?.body as { tools?: unknown }).tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Look up current weather for a location',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      },
    ]);
  });

  it('omits tools from the wire when the request carries none', async () => {
    const calls: Call[] = [];
    const { fetchImpl } = fakeFetch(
      (call) =>
        call.path.endsWith('/models')
          ? { status: 200, body: modelsListFixture }
          : { status: 200, body: chatCompletionSuccessFixture },
      calls,
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
    expect(chatCall?.body).not.toHaveProperty('tools');
  });

  it('RED FIXTURE: parses a scripted tool_calls response into normalized toolCalls with finishReason "tool_calls"', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: toolCallCompletionFixture },
    );
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });

    const response = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [{ role: 'user', content: 'what is the weather in NYC?' }],
      tools: [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }],
    });

    expect(response.finishReason).toBe('tool_calls');
    expect(response.toolCalls).toEqual([
      { id: 'call_abc123', name: 'get_weather', arguments: { location: 'NYC' } },
    ]);
  });

  it('throws ProviderResponseShapeError when a tool call carries unparseable arguments JSON', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : {
            status: 200,
            body: {
              ...toolCallCompletionFixture,
              choices: [
                {
                  ...toolCallCompletionFixture.choices[0],
                  message: {
                    ...toolCallCompletionFixture.choices[0]?.message,
                    tool_calls: [
                      {
                        id: 'call_bad',
                        type: 'function',
                        function: { name: 'get_weather', arguments: '{not json' },
                      },
                    ],
                  },
                },
              ],
            },
          },
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

  it('RED FIXTURE: serializes request.tools onto the streaming wire', async () => {
    const calls: Call[] = [];
    const { fetchImpl } = fakeStreamFetch(streamSuccessSse, calls);
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl,
    });

    const stream = provider.chatStream!({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }],
    });
    const iterator = stream[Symbol.asyncIterator]();
    while (!(await iterator.next()).done) {
      // drain
    }

    const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
    expect((chatCall?.body as { tools?: unknown }).tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_weather', parameters: { type: 'object', properties: {} } },
      },
    ]);
  });

  it('RED FIXTURE: accumulates streamed tool_calls deltas into normalized toolCalls with finishReason "tool_calls"', async () => {
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl: fakeStreamFetch(toolCallStreamSse).fetchImpl,
    });

    let final: import('./types.js').ChatResponse | undefined;
    for await (const event of provider.chatStream!({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'what is the weather in NYC?' }],
      tools: [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }],
    })) {
      if (event.type === 'final') final = event.response;
    }

    expect(final?.finishReason).toBe('tool_calls');
    expect(final?.toolCalls).toEqual([
      { id: 'call_stream_1', name: 'get_weather', arguments: { location: 'NYC' } },
    ]);
  });
});

describe('OaiCompatProvider — chatStream()', () => {
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

  it('yields delta events for every content chunk and a final event identical to chat()', async () => {
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl: fakeStreamFetch(streamSuccessSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { deltas, final } = await collect(
      provider.chatStream!({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(deltas).toEqual(['Hello', '!']);
    expect(final).toEqual({
      model: 'gpt-5.1',
      message: { role: 'assistant', content: 'Hello!' },
      finishReason: 'stop',
      usage: {
        promptTokens: 12,
        completionTokens: 9,
        totalTokens: 21,
        costUsd: (12 / 1_000_000) * 5 + (9 / 1_000_000) * 20,
      },
    });
  });

  it('surfaces truncation via finishReason "length" over the streaming path', async () => {
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl: fakeStreamFetch(streamTruncatedSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { final } = await collect(
      provider.chatStream!({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'write a long essay' }],
      }),
    );
    expect(final?.finishReason).toBe('length');
    expect(final?.usage.totalTokens).toBe(500);
  });

  it('usage metering uses the same cost-table formula as the non-streaming path (no unmetered streamed call)', async () => {
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl: fakeStreamFetch(streamSuccessSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { final } = await collect(
      provider.chatStream!({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(final?.usage.costUsd).toBe((12 / 1_000_000) * 5 + (9 / 1_000_000) * 20);
    expect(final?.usage.costUsd).toBeGreaterThan(0);
  });

  it('throws ProviderResponseShapeError when the stream ends without a usage chunk (stream-abort)', async () => {
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl: fakeStreamFetch(streamNoUsageSse).fetchImpl,
      costTable: SAMPLE_COST,
    });

    await expect(
      collect(
        provider.chatStream!({
          model: 'gpt-5.1',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('throws ProviderAuthError on 401 over the streaming path', async () => {
    const fetchImpl = (async () =>
      new Response(authFailureFixture.body, {
        status: authFailureFixture.status,
        statusText: authFailureFixture.statusText,
      })) as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    await expect(
      collect(
        provider.chatStream!({
          model: 'gpt-5.1',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('propagates a mid-stream connection error after partial deltas already yielded', async () => {
    const encoder = new TextEncoder();
    const partial = `data: ${JSON.stringify({
      id: 'chatcmpl-mid-stream-error',
      object: 'chat.completion.chunk',
      created: 1_752_000_003,
      model: 'gpt-5.1',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'partial' },
          finish_reason: null,
        },
      ],
    })}\n\n`;
    let pulls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/models')) {
        return new Response(JSON.stringify(modelsListFixture), { status: 200 });
      }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(encoder.encode(partial));
          } else {
            controller.error(new Error('ECONNRESET'));
          }
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const seenDeltas: string[] = [];
    await expect(
      (async () => {
        for await (const event of provider.chatStream!({
          model: 'gpt-5.1',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          if (event.type === 'delta') seenDeltas.push(event.content);
        }
      })(),
    ).rejects.toThrow('ECONNRESET');
    expect(seenDeltas).toEqual(['partial']);
  });

  it('reassembles a data line split across multiple stream chunks', async () => {
    const splitPoint = streamSuccessSse.indexOf('"content":"Hello"');
    const part1 = streamSuccessSse.slice(0, splitPoint);
    const part2 = streamSuccessSse.slice(splitPoint);
    const encoder = new TextEncoder();
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/models')) {
        return new Response(JSON.stringify(modelsListFixture), { status: 200 });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(part1));
          controller.enqueue(encoder.encode(part2));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const { final } = await collect(
      provider.chatStream!({
        model: 'gpt-5.1',
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
    let streamCallCount = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/models')) {
        return new Response(JSON.stringify(modelsListFixture), { status: 200 });
      }
      streamCallCount += 1;
      if (streamCallCount === 1) await gate;
      return new Response(streamSuccessSse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://localhost:9999/v1',
      fetchImpl,
      costTable: SAMPLE_COST,
      concurrency: 1,
    });
    await provider.warmUp(); // pre-warm so chatStream()'s ensureWarm() is a no-op below (deterministic queue timing)

    const first = collect(
      provider.chatStream!({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    await Promise.resolve();
    expect(provider.queueStats().active).toBe(1);
    const second = collect(
      provider.chatStream!({
        model: 'gpt-5.1',
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
