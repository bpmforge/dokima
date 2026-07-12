/**
 * Recorded response fixtures for adapter contract tests (docs/TESTING.md
 * §2/§7: "recorded fixtures, never live calls in CI"). Shapes verified
 * 2026-07-11 against OpenAI's chat-completions API reference, Ollama's
 * OpenAI-compatibility docs (docs.ollama.com/api/openai-compatibility —
 * usage is aggregated from PromptEvalCount/EvalCount into
 * prompt_tokens/completion_tokens/total_tokens), and LM Studio's
 * OpenAI-compat docs (lmstudio.ai/docs/app/api/endpoints/openai — default
 * port 1234, `/v1/models` returns `{ data: [{ id, object, owned_by }] }`).
 */

export const chatCompletionSuccessFixture = {
  id: 'chatcmpl-fixture-001',
  object: 'chat.completion',
  created: 1_752_000_000,
  model: 'qwen2.5-coder-7b-instruct',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello! How can I help you today?' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
};

export const chatCompletionTruncatedFixture = {
  id: 'chatcmpl-fixture-002',
  object: 'chat.completion',
  created: 1_752_000_001,
  model: 'qwen2.5-coder-7b-instruct',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'This response was cut off mid-' },
      finish_reason: 'length',
    },
  ],
  usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 },
};

export const modelsListFixture = {
  object: 'list',
  data: [
    { id: 'qwen2.5-coder-7b-instruct', object: 'model', owned_by: 'organization_owner' },
    { id: 'llama-3.2-3b-instruct', object: 'model', owned_by: 'organization_owner' },
  ],
};

export const authFailureFixture = {
  status: 401,
  statusText: 'Unauthorized',
  body: JSON.stringify({
    error: {
      message: 'Invalid API key provided',
      type: 'invalid_request_error',
      code: 'invalid_api_key',
    },
  }),
};

export const rateLimitFixture = {
  status: 429,
  statusText: 'Too Many Requests',
  retryAfterHeader: '2',
  body: JSON.stringify({
    error: {
      message: 'Rate limit reached, please slow down',
      type: 'requests',
      code: 'rate_limit_exceeded',
    },
  }),
};

export const serverErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({ error: { message: 'model crashed', type: 'server_error' } }),
};
