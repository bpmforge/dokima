/**
 * Recorded response fixtures for the Copilot adapter's contract tests
 * (docs/TESTING.md §2/§7: "recorded fixtures, never live calls in CI").
 * Shapes verified 2026-07-12 — device-flow fields against GitHub's official
 * OAuth device-flow docs; Copilot-internal token/chat/models shapes by
 * cross-referencing charmbracelet/catwalk, Nano-Collective/nanocoder, and
 * QuixiAI/Hexis (see copilot/index.ts's file header for the full citation).
 */

export const deviceCodeSuccessFixture = {
  device_code: 'fixture-device-code-0123456789abcdef',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

/** GitHub outage / bad client_id — the exact regression case the prior blocked attempt missed (status never checked before parsing). */
export const deviceCodeServerErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({ message: 'Internal Server Error' }),
};

export const accessTokenPendingFixture = {
  error: 'authorization_pending',
  error_description: 'The authorization request is still pending.',
};

/**
 * Same body as accessTokenPendingFixture, but served at HTTP 400 — RFC
 * 8628 §3.5 (via RFC 6749 §5.2) specifies continuable device-flow errors
 * as token-endpoint errors, which RFC 6749 defines as HTTP 400, not 200.
 * Real deployments have been observed to use either; the adapter must
 * treat both as pending.
 */
export const accessTokenPendingHttp400Fixture = {
  status: 400,
  statusText: 'Bad Request',
  body: JSON.stringify(accessTokenPendingFixture),
};

export const accessTokenSlowDownFixture = {
  error: 'slow_down',
  error_description: 'Polling too fast; slow down.',
};

export const accessTokenSuccessFixture = {
  access_token: 'ghu_fixture0123456789abcdefghijklmnop',
  token_type: 'bearer',
  scope: 'read:user',
};

export const accessTokenExpiredFixture = {
  error: 'expired_token',
  error_description: 'The device code has expired.',
};

export const accessTokenDeniedFixture = {
  error: 'access_denied',
  error_description: 'The user cancelled the authorization request.',
};

export const copilotTokenSuccessFixture = {
  token: 'tid=fixture-copilot-bearer;exp=1752003600',
  expires_at: 1_752_003_600,
  endpoints: { api: 'https://api.githubcopilot.com' },
};

/** 403 from the token endpoint — one of the two real-world "no Copilot Chat/API access" signals. */
export const copilotTokenForbiddenFixture = {
  status: 403,
  statusText: 'Forbidden',
  body: JSON.stringify({ message: 'access to this feature is not permitted' }),
};

/** 200 OK but no `token` field — the other documented "no Copilot Chat/API access" signal. */
export const copilotTokenNoAccessFixture = {
  endpoints: { api: 'https://api.githubcopilot.com' },
};

/** A `token` is present but `expires_at` is not — a malformed response, not a subscription problem. */
export const copilotTokenMissingExpiryFixture = {
  token: 'tid=fixture-copilot-bearer-no-expiry',
  endpoints: { api: 'https://api.githubcopilot.com' },
};

/** Invalid/expired GitHub OAuth token — needs re-auth, not a subscription problem. */
export const copilotTokenUnauthorizedFixture = {
  status: 401,
  statusText: 'Unauthorized',
  body: JSON.stringify({ message: 'Bad credentials' }),
};

export const copilotChatCompletionSuccessFixture = {
  id: 'chatcmpl-copilot-fixture-001',
  object: 'chat.completion',
  model: 'gpt-5.1',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello from Copilot!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
};

export const copilotChatCompletionTruncatedFixture = {
  id: 'chatcmpl-copilot-fixture-002',
  object: 'chat.completion',
  model: 'gpt-5.1',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'This response was cut off mid-' },
      finish_reason: 'length',
    },
  ],
  usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 },
};

export const copilotModelsListFixture = {
  object: 'list',
  data: [
    { id: 'gpt-5.1', name: 'GPT-5.1', object: 'model' },
    { id: 'claude-opus-4.8', name: 'Claude Opus 4.8', object: 'model' },
  ],
};

export const copilotRateLimitFixture = {
  status: 429,
  statusText: 'Too Many Requests',
  retryAfterHeader: '3',
  body: JSON.stringify({ message: 'Rate limit exceeded' }),
};

export const copilotServerErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({ message: 'internal error' }),
};
