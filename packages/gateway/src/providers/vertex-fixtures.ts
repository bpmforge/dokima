/**
 * Recorded response fixtures for the Vertex adapter's contract tests
 * (docs/TESTING.md §2/§7: "recorded fixtures, never live calls in CI").
 * Shapes verified 2026-07-12 (see vertex-chat.ts's and vertex-auth.ts's
 * file headers for sources).
 */

export const generateContentSuccessFixture = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ text: 'Hello! How can I help you today?' }],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 9, totalTokenCount: 21 },
};

export const generateContentTruncatedFixture = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ text: 'This response was cut off mid-' }],
      },
      finishReason: 'MAX_TOKENS',
    },
  ],
  usageMetadata: {
    promptTokenCount: 400,
    candidatesTokenCount: 100,
    totalTokenCount: 500,
  },
};

export const generateContentSafetyFixture = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: '' }] },
      finishReason: 'SAFETY',
    },
  ],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0, totalTokenCount: 8 },
};

export const countTokensSuccessFixture = { totalTokens: 3 };

export const authFailureFixture = {
  status: 401,
  statusText: 'Unauthorized',
  body: JSON.stringify({
    error: {
      code: 401,
      message: 'Request had invalid authentication credentials',
      status: 'UNAUTHENTICATED',
    },
  }),
};

export const rateLimitFixture = {
  status: 429,
  statusText: 'Too Many Requests',
  retryAfterHeader: '2',
  body: JSON.stringify({
    error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' },
  }),
};

export const serverErrorFixture = {
  status: 500,
  statusText: 'Internal Server Error',
  body: JSON.stringify({
    error: { code: 500, message: 'internal error', status: 'INTERNAL' },
  }),
};

export const tokenSuccessFixture = {
  access_token: 'ya29.fixture-access-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

export const tokenInvalidGrantFixture = {
  status: 400,
  statusText: 'Bad Request',
  body: JSON.stringify({
    error: 'invalid_grant',
    error_description: 'Invalid JWT Signature.',
  }),
};

export const authorizedUserCredentialsFixture = {
  type: 'authorized_user' as const,
  client_id: 'fixture-client-id.apps.googleusercontent.com',
  client_secret: 'fixture-client-secret',
  refresh_token: 'fixture-refresh-token',
};
