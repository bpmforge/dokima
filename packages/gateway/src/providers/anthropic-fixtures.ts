/**
 * Recorded response fixtures for the Anthropic adapter's contract tests
 * (docs/TESTING.md §2/§7: "recorded fixtures, never live calls in CI").
 * Shapes verified 2026-07-11 against platform.claude.com/docs/en/api/messages,
 * .../build-with-claude/streaming, and .../api/models-list.
 */

export const messageSuccessFixture = {
  id: 'msg_fixture_001',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
  model: 'claude-sonnet-5',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 9 },
};

export const messageTruncatedFixture = {
  id: 'msg_fixture_002',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'This response was cut off mid-' }],
  model: 'claude-sonnet-5',
  stop_reason: 'max_tokens',
  stop_sequence: null,
  usage: { input_tokens: 400, output_tokens: 100 },
};

export const modelsListFixture = {
  data: [
    {
      id: 'claude-sonnet-5',
      display_name: 'Claude Sonnet 5',
      max_input_tokens: 200_000,
      type: 'model',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      display_name: 'Claude Haiku 4.5',
      max_input_tokens: 200_000,
      type: 'model',
    },
  ],
  first_id: 'claude-sonnet-5',
  has_more: false,
  last_id: 'claude-haiku-4-5-20251001',
};

export const authFailureFixture = {
  status: 401,
  statusText: 'Unauthorized',
  body: JSON.stringify({
    type: 'error',
    error: { type: 'authentication_error', message: 'invalid x-api-key' },
  }),
};

export const rateLimitFixture = {
  status: 429,
  statusText: 'Too Many Requests',
  retryAfterHeader: '2',
  body: JSON.stringify({
    type: 'error',
    error: {
      type: 'rate_limit_error',
      message: 'Number of request tokens has exceeded your per-minute rate limit',
    },
  }),
};

export const overloadedFixture = {
  status: 529,
  statusText: 'Overloaded',
  body: JSON.stringify({
    type: 'error',
    error: { type: 'overloaded_error', message: 'Overloaded' },
  }),
};

export const serverErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({
    type: 'error',
    error: { type: 'api_error', message: 'internal error' },
  }),
};

/** Verbatim SSE shape per platform.claude.com/docs/en/build-with-claude/streaming. */
export const streamSuccessSse =
  'event: message_start\n' +
  'data: {"type":"message_start","message":{"id":"msg_stream_001","type":"message","role":"assistant","model":"claude-sonnet-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":25,"output_tokens":1}}}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'event: ping\n' +
  'data: {"type":"ping"}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}\n\n' +
  'event: content_block_stop\n' +
  'data: {"type":"content_block_stop","index":0}\n\n' +
  'event: message_delta\n' +
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}\n\n' +
  'event: message_stop\n' +
  'data: {"type":"message_stop"}\n\n';

export const streamTruncatedSse =
  'event: message_start\n' +
  'data: {"type":"message_start","message":{"id":"msg_stream_002","type":"message","role":"assistant","model":"claude-sonnet-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":400,"output_tokens":1}}}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"This response was cut off mid-"}}\n\n' +
  'event: content_block_stop\n' +
  'data: {"type":"content_block_stop","index":0}\n\n' +
  'event: message_delta\n' +
  'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"output_tokens":100}}\n\n' +
  'event: message_stop\n' +
  'data: {"type":"message_stop"}\n\n';

/** Mid-stream `error` event — "would normally correspond to an HTTP 529" per the streaming docs. */
export const streamOverloadedSse =
  'event: message_start\n' +
  'data: {"type":"message_start","message":{"id":"msg_stream_err","type":"message","role":"assistant","model":"claude-sonnet-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
  'event: error\n' +
  'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';

/** Connection drops after a partial delta — no message_delta/message_stop ever arrives. */
export const streamAbortSse =
  'event: message_start\n' +
  'data: {"type":"message_start","message":{"id":"msg_stream_abort","type":"message","role":"assistant","model":"claude-sonnet-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial resp"}}\n\n';
