/** Copilot-internal token exchange + refresh, and the authenticated Copilot-API request wrapper. */
import { ProviderAuthError, ProviderResponseShapeError } from './errors.js';
import { CopilotSubscriptionError, SUBSCRIPTION_REMEDIATION } from './copilot-errors.js';
import {
  COPILOT_INTEGRATION_ID,
  DEFAULT_COPILOT_API_BASE_URL,
  EDITOR_PLUGIN_VERSION,
  EDITOR_VERSION,
  GITHUB_API_BASE_URL,
  TOKEN_REFRESH_BUFFER_MS,
  USER_AGENT,
} from './copilot-types.js';
import type {
  CachedCopilotToken,
  CopilotRuntime,
  CopilotTokenResponse,
} from './copilot-types.js';

export async function loadGithubToken(runtime: CopilotRuntime): Promise<string> {
  const token = await runtime.credentialStore.get(runtime.credentialRef);
  if (!token) {
    throw new ProviderAuthError(
      runtime.id,
      401,
      'Unauthorized',
      `no GitHub token stored under credential ref "${runtime.credentialRef}" — run the device-auth flow first`,
    );
  }
  return token;
}

export async function ensureCopilotToken(
  runtime: CopilotRuntime,
): Promise<CachedCopilotToken> {
  if (
    runtime.cachedToken &&
    runtime.cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > runtime.now()
  ) {
    return runtime.cachedToken;
  }
  const githubToken = await loadGithubToken(runtime);
  const response = await runtime.fetchRaw(
    `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${githubToken}`,
        'editor-version': EDITOR_VERSION,
        'editor-plugin-version': EDITOR_PLUGIN_VERSION,
        'copilot-integration-id': COPILOT_INTEGRATION_ID,
        'user-agent': USER_AGENT,
      },
    },
    runtime.healthTimeoutMs,
  );
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    throw new CopilotSubscriptionError(
      runtime.id,
      SUBSCRIPTION_REMEDIATION,
      body || undefined,
    );
  }
  if (!response.ok) await runtime.throwHttpError(response);
  const body = (await response.json()) as CopilotTokenResponse;
  if (!body.token) {
    // 200 OK with no token field: authenticated fine, but this account/org
    // was never granted Copilot Chat/API scope (see index.ts).
    throw new CopilotSubscriptionError(runtime.id, SUBSCRIPTION_REMEDIATION);
  }
  if (body.expires_at === undefined) {
    throw new ProviderResponseShapeError(
      runtime.id,
      'token response is missing expires_at',
    );
  }
  const cached: CachedCopilotToken = {
    token: body.token,
    apiBase: (body.endpoints?.api ?? DEFAULT_COPILOT_API_BASE_URL).replace(/\/$/, ''),
    expiresAtMs: body.expires_at * 1000,
  };
  runtime.cachedToken = cached;
  return cached;
}

export async function requestCopilotApi<T>(
  runtime: CopilotRuntime,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const { token, apiBase } = await ensureCopilotToken(runtime);
  const response = await runtime.fetchRaw(
    `${apiBase}${path}`,
    {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'editor-version': EDITOR_VERSION,
        'editor-plugin-version': EDITOR_PLUGIN_VERSION,
        'copilot-integration-id': COPILOT_INTEGRATION_ID,
        'openai-intent': 'conversation-panel',
        'user-agent': USER_AGENT,
        ...(init.headers as Record<string, string> | undefined),
      },
    },
    timeoutMs,
  );
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    throw new CopilotSubscriptionError(
      runtime.id,
      SUBSCRIPTION_REMEDIATION,
      body || undefined,
    );
  }
  if (!response.ok) await runtime.throwHttpError(response);
  return (await response.json()) as T;
}
