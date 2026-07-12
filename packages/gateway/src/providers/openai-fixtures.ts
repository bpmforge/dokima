/**
 * Streaming-only fixtures for the OpenAI cloud adapter's contract tests
 * (docs/TESTING.md §2/§7: "recorded fixtures, never live calls in CI").
 * Non-streaming shapes are already covered by the co-located
 * OpenAI-compatible fixtures.ts (identical wire format for that path).
 * Chunk format verified 2026-07-11 against
 * developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events.
 */

const chunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

export const streamSuccessSse =
  chunk({
    id: 'chatcmpl-fixture-stream-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_000,
    model: 'gpt-5.1',
    choices: [
      { index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null },
    ],
  }) +
  chunk({
    id: 'chatcmpl-fixture-stream-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_000,
    model: 'gpt-5.1',
    choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
  }) +
  chunk({
    id: 'chatcmpl-fixture-stream-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_000,
    model: 'gpt-5.1',
    choices: [{ index: 0, delta: { content: '!' }, finish_reason: null }],
  }) +
  chunk({
    id: 'chatcmpl-fixture-stream-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_000,
    model: 'gpt-5.1',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }) +
  chunk({
    id: 'chatcmpl-fixture-stream-001',
    object: 'chat.completion.chunk',
    created: 1_752_000_000,
    model: 'gpt-5.1',
    choices: [],
    usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
  }) +
  'data: [DONE]\n\n';

export const streamTruncatedSse =
  chunk({
    id: 'chatcmpl-fixture-stream-002',
    object: 'chat.completion.chunk',
    created: 1_752_000_001,
    model: 'gpt-5.1',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: 'This response was cut off mid-' },
        finish_reason: null,
      },
    ],
  }) +
  chunk({
    id: 'chatcmpl-fixture-stream-002',
    object: 'chat.completion.chunk',
    created: 1_752_000_001,
    model: 'gpt-5.1',
    choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
  }) +
  chunk({
    id: 'chatcmpl-fixture-stream-002',
    object: 'chat.completion.chunk',
    created: 1_752_000_001,
    model: 'gpt-5.1',
    choices: [],
    usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 },
  }) +
  'data: [DONE]\n\n';

/** Connection drops (or the caller omitted stream_options.include_usage) — no usage-bearing chunk ever arrives. */
export const streamNoUsageSse =
  chunk({
    id: 'chatcmpl-fixture-stream-003',
    object: 'chat.completion.chunk',
    created: 1_752_000_002,
    model: 'gpt-5.1',
    choices: [
      { index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null },
    ],
  }) + 'data: [DONE]\n\n';
