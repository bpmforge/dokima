/**
 * W21-93. The model picker was offering embedding models as "the model that
 * writes the code" — measured 2026-08-28, LM Studio served four among 34 and
 * the picker listed all 34. An embedding model cannot generate text, so the
 * setup is broken by construction and fails much later.
 *
 * The answer existed and we were not asking: `/v1/models` is the OpenAI shape
 * (id, object, owned_by), while LM Studio's own `/api/v0/models` reports
 * `type` per model. Law 9(a): no live calls — `fetchImpl` is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLmStudioProvider, createOllamaProvider } from './oai-compat-presets.js';

const OPENAI_SHAPE = {
  data: [{ id: 'qwen3.8-flash-next' }, { id: 'text-embedding-nomic-embed-text-v1.5' }],
};
const NATIVE_SHAPE = {
  data: [
    { id: 'qwen3.8-flash-next', type: 'vlm' },
    { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings' },
  ],
};

function fakeFetch(native: unknown, nativeOk = true): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v0/models')) {
      return new Response(JSON.stringify(native), { status: nativeOk ? 200 : 404 });
    }
    return new Response(JSON.stringify(OPENAI_SHAPE), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('createLmStudioProvider: what the provider SAID, never the model id', () => {
  it('RED FIXTURE: an embedding model is reported as one', async () => {
    const p = createLmStudioProvider({ fetchImpl: fakeFetch(NATIVE_SHAPE) });
    const models = await p.listModels();
    expect(models.find((m) => m.id.startsWith('text-embedding'))?.kind).toBe('embedding');
  });

  it('a generative model is reported as generative', async () => {
    const p = createLmStudioProvider({ fetchImpl: fakeFetch(NATIVE_SHAPE) });
    expect(models(await p.listModels(), 'qwen3.8-flash-next')).toBe('generative');
  });

  it('when the native route is absent, kind stays UNKNOWN — not "generative"', async () => {
    const p = createLmStudioProvider({ fetchImpl: fakeFetch(null, false) });
    const list = await p.listModels();
    expect(list).toHaveLength(2);
    expect(list.every((m) => m.kind === undefined)).toBe(true);
  });

  it('a type it has never heard of is left absent rather than guessed', async () => {
    const p = createLmStudioProvider({
      fetchImpl: fakeFetch({ data: [{ id: 'qwen3.8-flash-next', type: 'something-new' }] }),
    });
    expect(models(await p.listModels(), 'qwen3.8-flash-next')).toBeUndefined();
  });

  it('malformed native output does not lose the model list', async () => {
    const p = createLmStudioProvider({ fetchImpl: fakeFetch({ data: 'not an array' }) });
    const list = await p.listModels();
    expect(list.map((m) => m.id)).toEqual(OPENAI_SHAPE.data.map((m) => m.id));
  });

  it('ollama is NOT assumed to match LM Studio — it reports no kind at all', async () => {
    const p = createOllamaProvider({ fetchImpl: fakeFetch(NATIVE_SHAPE) });
    const list = await p.listModels();
    expect(list.every((m) => m.kind === undefined)).toBe(true);
  });
});

function models(list: { id: string; kind?: string }[], id: string): string | undefined {
  return list.find((m) => m.id === id)?.kind;
}

/**
 * The wrapper originally used `{ ...provider }`, which spreads a CLASS
 * INSTANCE — own properties copied, every prototype method dropped. `chat`
 * became undefined and the guided-sample e2e failed with "gateway calls: {}".
 * Unit tests missed it entirely because they only called `listModels`.
 */
describe('the enriched provider is still a whole provider', () => {
  it('RED FIXTURE: every Provider method survives the wrapper', () => {
    const p = createLmStudioProvider({ fetchImpl: fakeFetch(NATIVE_SHAPE) });
    for (const method of ['chat', 'listModels', 'getContextLength', 'health', 'warmUp', 'queueStats']) {
      expect(typeof (p as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
  });

  it('chat actually reaches the underlying adapter', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/v0/models')) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const p = createLmStudioProvider({ fetchImpl });
    const res = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.message.content).toBe('hi');
    expect(calls.some((u) => u.includes('/chat/completions'))).toBe(true);
  });
});
