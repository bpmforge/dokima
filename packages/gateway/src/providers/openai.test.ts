import { describe, expect, it } from 'vitest';
import {
  authFailureFixture,
  chatCompletionSuccessFixture,
  chatCompletionTruncatedFixture,
  modelsListFixture,
  rateLimitFixture,
} from './fixtures.js';
import {
  streamNoUsageSse,
  streamSuccessSse,
  streamTruncatedSse,
} from './openai-fixtures.js';
import { createOpenAiProvider } from './openai.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
} from './errors.js';
import type { CostTable } from './usage.js';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

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

/** Answers a POST /chat/completions with a raw SSE body, everything else with the models fixture. */
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

const SAMPLE_COST: CostTable = {
  'qwen2.5-coder-7b-instruct': { inputPerMillion: 3, outputPerMillion: 15 },
  'gpt-5.1': { inputPerMillion: 5, outputPerMillion: 20 },
};

describe('OpenAiProvider — chat() non-streaming (delegates to OaiCompatProvider)', () => {
  it('sends a real Authorization bearer header and parses a successful completion', async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: chatCompletionSuccessFixture },
    );
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const response = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.message.content).toBe('Hello! How can I help you today?');
    expect(response.finishReason).toBe('stop');
    expect(response.usage.costUsd).toBeCloseTo(
      (12 / 1_000_000) * 3 + (9 / 1_000_000) * 15,
    );
    const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
    expect(chatCall?.headers.authorization).toBe('Bearer sk-test');
  });

  it('sends OpenAI-Organization and OpenAI-Project headers when configured', async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: chatCompletionSuccessFixture },
    );
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      organization: 'org-123',
      project: 'proj-456',
    });

    await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
    expect(chatCall?.headers['openai-organization']).toBe('org-123');
    expect(chatCall?.headers['openai-project']).toBe('proj-456');
  });

  it('surfaces truncation via finishReason "length"', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : { status: 200, body: chatCompletionTruncatedFixture },
    );
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const response = await provider.chat({
      model: 'qwen2.5-coder-7b-instruct',
      messages: [{ role: 'user', content: 'write a long essay' }],
    });
    expect(response.finishReason).toBe('length');
  });

  it('throws ProviderAuthError on 401', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.path.endsWith('/models')
        ? { status: 200, body: modelsListFixture }
        : {
            status: authFailureFixture.status,
            statusText: authFailureFixture.statusText,
            body: JSON.parse(authFailureFixture.body),
          },
    );
    const provider = createOpenAiProvider({
      apiKey: 'bad-key',
      fetchImpl,
      costTable: SAMPLE_COST,
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
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });

    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as InstanceType<typeof ProviderRateLimitError>).retryAfterMs).toBe(2000);
  });

  it('queueStats() reports the inner OaiCompatProvider queue when not streaming', () => {
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      costTable: SAMPLE_COST,
      concurrency: 3,
    });
    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 3 });
  });
});

describe('OpenAiProvider — chat() streaming', () => {
  it('aggregates SSE chunks into the same normalized ChatResponse as the non-streaming path', async () => {
    const { fetchImpl, calls } = fakeStreamFetch(streamSuccessSse);
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response).toEqual({
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
    const chatCall = calls.find((c) => c.path.endsWith('/chat/completions'));
    expect(
      (chatCall?.body as { stream_options: { include_usage: boolean } }).stream_options,
    ).toEqual({
      include_usage: true,
    });
  });

  it('surfaces truncation via finishReason "length" over the streaming path', async () => {
    const { fetchImpl } = fakeStreamFetch(streamTruncatedSse);
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'write a long essay' }],
    });
    expect(response.finishReason).toBe('length');
    expect(response.message.content).toBe('This response was cut off mid-');
    expect(response.usage.totalTokens).toBe(500);
  });

  it('throws ProviderAuthError on 401 over the streaming path (fetchRaw/throwForStatus, not the inner provider)', async () => {
    const fetchImpl = (async () =>
      new Response(authFailureFixture.body, {
        status: authFailureFixture.status,
        statusText: authFailureFixture.statusText,
      })) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'bad-key',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('throws ProviderResponseShapeError when the stream ends without a usage chunk (stream-abort)', async () => {
    const { fetchImpl } = fakeStreamFetch(streamNoUsageSse);
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('reassembles a data line split across multiple stream chunks', async () => {
    const splitPoint = streamSuccessSse.indexOf('"content":"Hello"');
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
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
      stream: true,
    });

    const response = await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.message.content).toBe('Hello!');
  });

  it('queueStats() reports the dedicated streaming queue when streaming is enabled', () => {
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      costTable: SAMPLE_COST,
      concurrency: 2,
      stream: true,
    });
    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 2 });
  });
});

describe('factory', () => {
  it('createOpenAiProvider defaults id to "openai" and baseUrl to api.openai.com/v1', async () => {
    const calls: Call[] = [];
    const { fetchImpl } = fakeFetch(
      () => ({ status: 200, body: modelsListFixture }),
      calls,
    );
    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      fetchImpl,
      costTable: SAMPLE_COST,
    });
    expect(provider.id).toBe('openai');

    await provider.listModels();
    expect(calls[0]?.path).toBe('/v1/models');
  });
});
