import { describe, expect, it, vi } from 'vitest';
import type { ChatResponse } from './types.js';
import {
  isProviderError,
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
import { createOaiCompatProvider } from './oai-compat.js';
import { createLmStudioProvider, createOllamaProvider } from './oai-compat-presets.js';
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

/** A plain follow-up answer, no tool_calls — the second turn of a tool round trip (W11-12). */
const toolResultAnsweredFixture = {
  id: 'chatcmpl-fixture-tools-002',
  object: 'chat.completion',
  created: 1_752_000_012,
  model: 'qwen2.5-coder-7b-instruct',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'It is 72F and sunny in NYC.' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
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

  it('RED FIXTURE: a two-turn tool exchange round-trips onto the wire — assistant tool_calls echoed back, a tool-role result answered, the provider parses the final answer', async () => {
    const calls: Call[] = [];
    let chatCallCount = 0;
    const { fetchImpl } = fakeFetch((call) => {
      if (call.path.endsWith('/models')) return { status: 200, body: modelsListFixture };
      chatCallCount += 1;
      return {
        status: 200,
        body: chatCallCount === 1 ? toolCallCompletionFixture : toolResultAnsweredFixture,
      };
    }, calls);
    const provider = createOaiCompatProvider({
      id: 'generic',
      baseUrl: 'http://x/v1',
      fetchImpl,
    });
    const tools = [
      { name: 'get_weather', parameters: { type: 'object', properties: {} } },
    ];

    const first = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [{ role: 'user', content: 'what is the weather in NYC?' }],
      tools,
    });
    expect(first.toolCalls).toEqual([
      { id: 'call_abc123', name: 'get_weather', arguments: { location: 'NYC' } },
    ]);

    const second = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [
        { role: 'user', content: 'what is the weather in NYC?' },
        { ...first.message, toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: 'call_abc123', content: '72F and sunny' },
      ],
      tools,
    });

    const chatCalls = calls.filter((c) => c.path.endsWith('/chat/completions'));
    expect(chatCalls[1]?.body).toMatchObject({
      messages: [
        { role: 'user', content: 'what is the weather in NYC?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
            },
          ],
        },
        { role: 'tool', content: '72F and sunny', tool_call_id: 'call_abc123' },
      ],
    });
    expect(second.message.content).toBe('It is 72F and sunny in NYC.');
    expect(second.toolCalls).toBeUndefined();
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
      else if (event.type === 'final') final = event.response;
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

/**
 * W13-10. Found in live testing against a remote LM Studio: `prism-ml/bonsai-27b`
 * is a reasoning model that spends ~200 tokens thinking before every answer,
 * and the only thing that stops it is `reasoning_effort` — measured, with
 * `chat_template_kwargs.enable_thinking` and a `/no_think` suffix both doing
 * nothing. The adapter had no way to send it.
 */
describe('per-endpoint request extras (W13-10)', () => {
  function capture(): { calls: unknown[]; fetchImpl: typeof fetch } {
    const calls: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'x',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const ask = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

  it('RED FIXTURE: a configured extra reaches the request body', async () => {
    const { calls, fetchImpl } = capture();
    const provider = createOaiCompatProvider({
      id: 'studio',
      baseUrl: 'http://example.invalid/v1',
      fetchImpl,
      requestExtras: { reasoning_effort: 'none' },
    });
    await provider.chat(ask);
    expect((calls[0] as Record<string, unknown>).reasoning_effort).toBe('none');
  });

  it(
    'CANNOT override model or messages. A provider entry that could rewrite the ' +
      'routed model would silently defeat the model matrix — and with it the ' +
      'maker != verifier separation routing enforces',
    async () => {
      const { calls, fetchImpl } = capture();
      const provider = createOaiCompatProvider({
        id: 'studio',
        baseUrl: 'http://example.invalid/v1',
        fetchImpl,
        requestExtras: {
          model: 'attacker/other-model',
          messages: [{ role: 'user', content: 'replaced' }],
          reasoning_effort: 'none',
        },
      });
      await provider.chat(ask);
      const body = calls[0] as Record<string, unknown>;
      expect(body.model).toBe('m');
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      // The legitimate extra still lands.
      expect(body.reasoning_effort).toBe('none');
    },
  );

  it('a provider without extras sends exactly what it sent before — no empty keys', async () => {
    const { calls, fetchImpl } = capture();
    const provider = createOaiCompatProvider({
      id: 'studio',
      baseUrl: 'http://example.invalid/v1',
      fetchImpl,
    });
    await provider.chat(ask);
    expect(Object.keys(calls[0] as object).sort()).toEqual(['messages', 'model']);
  });
});

describe('streaming carries requestExtras too (W13-15)', () => {
  it(
    'RED FIXTURE: my own W13-10 miss — extras reached chat() and not chatStream(). ' +
      'A provider configured to stop a model thinking would have started thinking ' +
      'again the moment the session streamed',
    async () => {
      const bodies: unknown[] = [];
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          'data: {"model":"m","choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n' +
            'data: {"model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n' +
            'data: [DONE]\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }) as unknown as typeof fetch;

      const provider = createOaiCompatProvider({
        id: 'studio',
        baseUrl: 'http://example.invalid/v1',
        fetchImpl,
        requestExtras: { reasoning_effort: 'none' },
      });
      // Collected, not discarded: a drain loop that binds nothing proves the
      // request was SENT but not that the stream was READABLE, and every
      // assertion below is about the request only.
      const chunks = [];
      for await (const chunk of provider.chatStream!({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);

      const body = bodies[0] as Record<string, unknown>;
      expect(body.reasoning_effort).toBe('none');
      expect(body.stream).toBe(true);
      // Still cannot clobber the routed model.
      expect(body.model).toBe('m');
    },
  );

  describe('a producing stream is not on a clock (W13-22)', () => {
    /**
     * An SSE body that keeps sending, slowly, and HONOURS the signal it was
     * given — which is the whole point. A fake fetch that ignores `init.signal`
     * enforces no cap at all, so the test passes whichever signal was handed
     * over and proves nothing. (My first version did exactly that: it stayed
     * green with the fix reverted.)
     */
    function slowHonouringStream(
      signal: AbortSignal | null | undefined,
      chunks: number,
      gapMs: number,
    ): ReadableStream<Uint8Array> {
      const enc = new TextEncoder();
      let i = 0;
      return new ReadableStream({
        async pull(controller) {
          if (signal?.aborted) {
            controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          if (i < chunks) {
            await new Promise((r) => setTimeout(r, gapMs));
            if (signal?.aborted) {
              controller.error(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              );
              return;
            }
            controller.enqueue(
              enc.encode(
                `data: {"model":"m","choices":[{"delta":{"content":"${i}"}}]}\n\n`,
              ),
            );
            i += 1;
            return;
          }
          controller.enqueue(
            enc.encode(
              'data: {"model":"m","choices":[{"delta":{},"finish_reason":"stop"}],' +
                '"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
            ),
          );
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
    }

    it(
      'RED FIXTURE: a stream still producing PAST requestTimeoutMs is not ' +
        'aborted. The idle signal used to be overwritten by ' +
        'AbortSignal.timeout after the ...init spread, so W13-15 replaced a ' +
        'duration cap with an idle cap and the duration cap never left — ' +
        'invisible on any model fast enough never to run a long turn',
      async () => {
        const provider = createOaiCompatProvider({
          id: 'studio',
          baseUrl: 'http://example.invalid/v1',
          // Total cap far shorter than the stream takes; idle cap generous.
          // With the bug the fetch gets the 40ms total signal and dies; with
          // the fix it gets the idle signal, bumped on every chunk.
          requestTimeoutMs: 40,
          streamIdleMs: 5_000,
          fetchImpl: (async (_url: string, init: RequestInit) =>
            new Response(slowHonouringStream(init.signal, 6, 25), {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            })) as unknown as typeof fetch,
        });

        const seen: string[] = [];
        for await (const event of provider.chatStream!({
          model: 'm',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          if (event.type === 'delta') seen.push(event.content);
        }
        expect(seen.join('')).toBe('012345');
      },
    );

    it(
      'RED FIXTURE: an abort mid-body is a ProviderTimeoutError, not a raw ' +
        'DOMException. fetchRaw translates TimeoutError only around the INITIAL ' +
        'fetch — once headers arrive it has returned, so a stall escaped ' +
        'unclassified, isProviderError said false, and the session could not ' +
        'absorb it: the run died with the ticket stranded at in_progress',
      async () => {
        const provider = createOaiCompatProvider({
          id: 'studio',
          baseUrl: 'http://example.invalid/v1',
          streamIdleMs: 50,
          fetchImpl: (async () =>
            new Response(
              new ReadableStream({
                pull(controller) {
                  // Exactly what a real body does when its signal aborts.
                  controller.error(
                    Object.assign(new Error('aborted'), { name: 'AbortError' }),
                  );
                },
              }),
              { status: 200, headers: { 'content-type': 'text/event-stream' } },
            )) as unknown as typeof fetch,
        });

        const err = await (async () => {
          try {
            const drained: string[] = [];
            for await (const event of provider.chatStream!({
              model: 'm',
              messages: [{ role: 'user', content: 'hi' }],
            })) {
              if (event.type === 'delta') drained.push(event.content);
            }
            return undefined;
          } catch (e) {
            return e;
          }
        })();

        expect(err).toBeInstanceOf(ProviderTimeoutError);
        // The property that makes it absorbable rather than fatal.
        expect(isProviderError(err)).toBe(true);
      },
    );
  });

  describe('tool-call deltas are surfaced (W13-20)', () => {
    function toolStream(): ReadableStream<Uint8Array> {
      const enc = new TextEncoder();
      const lines = [
        // The name lands on the first fragment; arguments dribble after it.
        'data: {"model":"m","choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":"{\\"pa"}}]}}]}',
        'data: {"model":"m","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.ts\\"}"}}]}}]}',
        'data: {"model":"m","choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"verify","arguments":"{}"}}]}}]}',
        'data: {"model":"m","choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
        'data: [DONE]',
      ];
      return new ReadableStream({
        start(c) {
          for (const l of lines) c.enqueue(enc.encode(l + '\n\n'));
          c.close();
        },
      });
    }

    it(
      'RED FIXTURE: a turn that emits ONLY tool calls produces observable ' +
        'events. W13-16 made the session streamable and then measured that 41% ' +
        'of one model’s turns still produced nothing, because these deltas were ' +
        'parsed into an accumulator and discarded',
      async () => {
        const provider = createOaiCompatProvider({
          id: 'studio',
          baseUrl: 'http://example.invalid/v1',
          fetchImpl: (async () =>
            new Response(toolStream(), {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            })) as unknown as typeof fetch,
        });

        const announced: Array<{ index: number; name: string }> = [];
        let final: ChatResponse | undefined;
        for await (const event of provider.chatStream!({
          model: 'm',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          if (event.type === 'tool_call')
            announced.push({ index: event.index, name: event.name });
          else if (event.type === 'final') final = event.response;
        }

        // ONE per tool call, when the NAME lands — not one per argument
        // fragment, which would say nothing and flood anything downstream.
        expect(announced).toEqual([
          { index: 0, name: 'read' },
          { index: 1, name: 'verify' },
        ]);
        // And the assembled call is unchanged: this surfaces what was already
        // being parsed, it does not re-parse it.
        expect(final?.toolCalls?.map((t: { name: string }) => t.name)).toEqual([
          'read',
          'verify',
        ]);
        expect(final?.toolCalls?.[0]?.arguments).toEqual({ path: 'a.ts' });
      },
    );
  });
});

describe('a timed-out call names the model it was for (W22-07)', () => {
  /** What `AbortSignal.timeout` actually throws — name, not class. */
  function timeoutError(): Error {
    return Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  }

  it(
    'RED FIXTURE: chat() surfaces the model. Asserting on the error CLASS alone ' +
      'would have passed while the model never left the request — the ' +
      '"settable and inert" shape docs/TESTING.md 6c was written for',
    async () => {
      const fetchImpl = (async () => {
        throw timeoutError();
      }) as unknown as typeof fetch;
      const provider = createOaiCompatProvider({
        id: 'lm-studio',
        baseUrl: 'http://localhost:1234/v1',
        fetchImpl,
        costTable: NO_COST,
      });

      await expect(
        provider.chat({
          model: 'qwen3.8-flash-next',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow(/qwen3\.8-flash-next/);
    },
  );

  it('the model reaches the error object, not only the message', async () => {
    const fetchImpl = (async () => {
      throw timeoutError();
    }) as unknown as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'lm-studio',
      baseUrl: 'http://localhost:1234/v1',
      fetchImpl,
      costTable: NO_COST,
    });

    const err = await provider
      .chat({ model: 'gemma-4-e4b-it-mlx', messages: [{ role: 'user', content: 'hi' }] })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderTimeoutError);
    expect((err as ProviderTimeoutError).model).toBe('gemma-4-e4b-it-mlx');
    expect((err as ProviderTimeoutError).providerId).toBe('lm-studio');
  });

  it('model discovery still times out WITHOUT a model, because it has none', async () => {
    // The degrade-honestly half of the acceptance: listModels is not for any
    // model, so naming one would be an invention.
    const fetchImpl = (async () => {
      throw timeoutError();
    }) as unknown as typeof fetch;
    const provider = createOaiCompatProvider({
      id: 'lm-studio',
      baseUrl: 'http://localhost:1234/v1',
      fetchImpl,
      costTable: NO_COST,
    });

    const err = await provider
      .listModels()
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderTimeoutError);
    expect((err as ProviderTimeoutError).model).toBeUndefined();
  });
});

describe('P6-15 — long local calls escape the undici 300s headers clamp', () => {
  function providerWith(timeoutMs: number, captured: RequestInit[]) {
    return createOaiCompatProvider({
      id: 'lm-studio',
      baseUrl: 'http://127.0.0.1:9',
      requestTimeoutMs: timeoutMs,
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured.push(init ?? {});
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch,
    });
  }

  it('at or below the undici default no dispatcher rides the request', async () => {
    const captured: RequestInit[] = [];
    await providerWith(300_000, captured).listModels();
    expect(captured.length).toBeGreaterThan(0);
    expect((captured[0] as { dispatcher?: unknown }).dispatcher).toBeUndefined();
  });

  it('above it, the CHAT call (the one that grinds) carries a dispatcher — and it is cached across calls', async () => {
    const captured: RequestInit[] = [];
    const p = createOaiCompatProvider({
      id: 'lm-studio',
      baseUrl: 'http://127.0.0.1:9',
      requestTimeoutMs: 900_000,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        captured.push({ ...(init ?? {}), _url: String(url) } as RequestInit);
        return new Response(JSON.stringify(chatCompletionSuccessFixture), {
          status: 200,
        });
      }) as typeof fetch,
    });
    const req = {
      model: 'qwen/qwen3.8-27b',
      messages: [{ role: 'user' as const, content: 'hi' }],
    };
    await p.chat(req);
    await p.chat(req);
    // warm-up/discovery calls ride short timeouts with NO dispatcher; the
    // chat completions — the calls that grind — must carry the Agent.
    const chats = captured.filter((c) =>
      String((c as { _url?: string })._url).includes('/chat/completions'),
    );
    expect(chats.length).toBe(2);
    const dispatchers = chats.map((c) => (c as { dispatcher?: unknown }).dispatcher);
    expect(dispatchers[0]).toBeDefined();
    expect(dispatchers[0]).toBe(dispatchers[1]);
  });
});
