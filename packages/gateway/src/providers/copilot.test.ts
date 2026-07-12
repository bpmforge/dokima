import { describe, expect, it, vi } from 'vitest';
import {
  accessTokenDeniedFixture,
  accessTokenExpiredFixture,
  accessTokenPendingFixture,
  accessTokenPendingHttp400Fixture,
  accessTokenSlowDownFixture,
  accessTokenSuccessFixture,
  copilotChatCompletionSuccessFixture,
  copilotChatCompletionTruncatedFixture,
  copilotModelsListFixture,
  copilotRateLimitFixture,
  copilotServerErrorFixture,
  copilotTokenForbiddenFixture,
  copilotTokenMissingExpiryFixture,
  copilotTokenNoAccessFixture,
  copilotTokenSuccessFixture,
  copilotTokenUnauthorizedFixture,
  deviceCodeServerErrorFixture,
  deviceCodeSuccessFixture,
} from './copilot-fixtures.js';
import {
  COPILOT_OAUTH_CLIENT_ID,
  CopilotDeviceAuthError,
  CopilotSubscriptionError,
  DEFAULT_COPILOT_CREDENTIAL_REF,
  createCopilotProvider,
  type CopilotCredentialStore,
} from './copilot.js';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
} from './errors.js';
import type { CostTable } from './usage.js';

interface Call {
  method: string;
  url: string;
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
    const url = typeof input === 'string' ? input : input.toString();
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
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

function inMemoryCredentialStore(seed?: Record<string, string>): CopilotCredentialStore {
  const entries = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    async get(ref) {
      return entries.get(ref);
    },
    async set(ref, value) {
      entries.set(ref, value);
    },
    async delete(ref) {
      entries.delete(ref);
    },
  };
}

const SAMPLE_COST: CostTable = {
  'gpt-5.1': { inputPerMillion: 4, outputPerMillion: 16 },
};

describe('CopilotProvider — device-auth first-run flow', () => {
  it('requestDeviceCode() parses a successful response and sends the public client id', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: deviceCodeSuccessFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    const info = await provider.requestDeviceCode();

    expect(info).toEqual({
      deviceCode: 'fixture-device-code-0123456789abcdef',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
    expect(calls[0]?.url).toBe('https://github.com/login/device/code');
    expect(calls[0]?.body).toEqual({
      client_id: COPILOT_OAUTH_CLIENT_ID,
      scope: 'read:user',
    });
  });

  it('throws ProviderHttpError instead of parsing an error body as success (regression: prior blocked attempt never checked status here)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: deviceCodeServerErrorFixture.status,
      statusText: deviceCodeServerErrorFixture.statusText,
      body: JSON.parse(deviceCodeServerErrorFixture.body),
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    await expect(provider.requestDeviceCode()).rejects.toThrow(ProviderHttpError);
  });

  it('requestDeviceCode() throws ProviderResponseShapeError on a malformed 200 body', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: { user_code: 'ABCD-1234' },
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    await expect(provider.requestDeviceCode()).rejects.toThrow(
      ProviderResponseShapeError,
    );
  });

  it('pollDeviceAuthorization() returns pending and echoes the interval on authorization_pending', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: accessTokenPendingFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    const result = await provider.pollDeviceAuthorization('device-code', 5_000);
    expect(result).toEqual({ status: 'pending', intervalMs: 5_000 });
  });

  it('pollDeviceAuthorization() treats authorization_pending as pending even when GitHub serves it at HTTP 400 (RFC 8628 §3.5 via RFC 6749 §5.2 — regression: a status-first check would wrongly abort the auth loop)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: accessTokenPendingHttp400Fixture.status,
      statusText: accessTokenPendingHttp400Fixture.statusText,
      body: JSON.parse(accessTokenPendingHttp400Fixture.body),
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    const result = await provider.pollDeviceAuthorization('device-code', 5_000);
    expect(result).toEqual({ status: 'pending', intervalMs: 5_000 });
  });

  it('pollDeviceAuthorization() adds 5s to the interval on slow_down', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: accessTokenSlowDownFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    const result = await provider.pollDeviceAuthorization('device-code', 5_000);
    expect(result).toEqual({ status: 'pending', intervalMs: 10_000 });
  });

  it('pollDeviceAuthorization() persists the GitHub token via the credential ref on success', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: accessTokenSuccessFixture,
    }));
    const store = inMemoryCredentialStore();
    const provider = createCopilotProvider({ fetchImpl, credentialStore: store });

    const result = await provider.pollDeviceAuthorization('device-code', 5_000);

    expect(result).toEqual({ status: 'complete' });
    expect(await store.get(DEFAULT_COPILOT_CREDENTIAL_REF)).toBe(
      accessTokenSuccessFixture.access_token,
    );
    expect(calls[0]?.body).toEqual({
      client_id: COPILOT_OAUTH_CLIENT_ID,
      device_code: 'device-code',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });

  it('pollDeviceAuthorization() throws CopilotDeviceAuthError with the code on expired_token', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: accessTokenExpiredFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    const err = await provider
      .pollDeviceAuthorization('device-code', 5_000)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopilotDeviceAuthError);
    expect((err as CopilotDeviceAuthError).code).toBe('expired_token');
  });

  it('pollDeviceAuthorization() throws CopilotDeviceAuthError on access_denied', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: accessTokenDeniedFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    await expect(provider.pollDeviceAuthorization('device-code', 5_000)).rejects.toThrow(
      CopilotDeviceAuthError,
    );
  });

  it('pollDeviceAuthorization() throws ProviderHttpError on a non-2xx response (regression: prior blocked attempt never checked status here either)', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 500,
      statusText: 'Internal Server Error',
      body: { message: 'boom' },
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    await expect(provider.pollDeviceAuthorization('device-code', 5_000)).rejects.toThrow(
      ProviderHttpError,
    );
  });
});

describe('CopilotProvider — Copilot-internal token exchange + refresh', () => {
  function fetchThatCounts(chatBody: unknown = copilotChatCompletionSuccessFixture) {
    const tokenCalls: Call[] = [];
    return fakeFetch((call) => {
      if (call.url.endsWith('/copilot_internal/v2/token')) {
        tokenCalls.push(call);
        return { status: 200, body: copilotTokenSuccessFixture };
      }
      return { status: 200, body: chatBody };
    });
  }

  it('exchanges the stored GitHub token for a Copilot bearer and caches it across calls', async () => {
    let tokenCalls = 0;
    const { fetchImpl } = fakeFetch((call) => {
      if (call.url.endsWith('/copilot_internal/v2/token')) {
        tokenCalls += 1;
        return { status: 200, body: copilotTokenSuccessFixture };
      }
      return { status: 200, body: copilotChatCompletionSuccessFixture };
    });
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
      costTable: SAMPLE_COST,
      now: () => (copilotTokenSuccessFixture.expires_at - 3600) * 1000,
    });

    await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi again' }],
    });

    expect(tokenCalls).toBe(1);
  });

  it('re-exchanges once the cached token is within the refresh buffer of expiring', async () => {
    let tokenCalls = 0;
    let now = (copilotTokenSuccessFixture.expires_at - 3600) * 1000;
    const { fetchImpl } = fakeFetch((call) => {
      if (call.url.endsWith('/copilot_internal/v2/token')) {
        tokenCalls += 1;
        return { status: 200, body: copilotTokenSuccessFixture };
      }
      return { status: 200, body: copilotChatCompletionSuccessFixture };
    });
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
      costTable: SAMPLE_COST,
      now: () => now,
    });

    await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(tokenCalls).toBe(1);

    now = copilotTokenSuccessFixture.expires_at * 1000 + 1;
    await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(tokenCalls).toBe(2);
  });

  it('throws ProviderAuthError with remediation detail when no GitHub token has been stored yet', async () => {
    const { fetchImpl } = fetchThatCounts();
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore(),
    });

    const err = await provider
      .chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect((err as ProviderAuthError).body).toContain('run the device-auth flow first');
  });

  it('throws CopilotSubscriptionError with remediation text on a 403 from the token endpoint', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? {
            status: copilotTokenForbiddenFixture.status,
            statusText: copilotTokenForbiddenFixture.statusText,
            body: JSON.parse(copilotTokenForbiddenFixture.body),
          }
        : { status: 200, body: copilotChatCompletionSuccessFixture },
    );
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    const err = await provider
      .chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopilotSubscriptionError);
    expect((err as CopilotSubscriptionError).remediation).toMatch(
      /github\.com\/settings\/copilot/,
    );
  });

  it('throws CopilotSubscriptionError with remediation text when the token endpoint returns 200 without a token field', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? { status: 200, body: copilotTokenNoAccessFixture }
        : { status: 200, body: copilotChatCompletionSuccessFixture },
    );
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(CopilotSubscriptionError);
  });

  it('throws ProviderResponseShapeError (not a subscription error) when the token endpoint returns a token but no expires_at', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? { status: 200, body: copilotTokenMissingExpiryFixture }
        : { status: 200, body: copilotChatCompletionSuccessFixture },
    );
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });

  it('throws ProviderAuthError (not a subscription error) on 401 from the token endpoint', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? {
            status: copilotTokenUnauthorizedFixture.status,
            statusText: copilotTokenUnauthorizedFixture.statusText,
            body: JSON.parse(copilotTokenUnauthorizedFixture.body),
          }
        : { status: 200, body: copilotChatCompletionSuccessFixture },
    );
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_expired',
      }),
    });

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderAuthError);
  });
});

describe('CopilotProvider — chat()', () => {
  function providerWithToken(
    handler: (call: Call) => {
      status: number;
      statusText?: string;
      body: unknown;
      headers?: Record<string, string>;
    },
  ) {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? { status: 200, body: copilotTokenSuccessFixture }
        : handler(call),
    );
    return {
      calls,
      provider: createCopilotProvider({
        fetchImpl,
        credentialStore: inMemoryCredentialStore({
          [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
        }),
        costTable: SAMPLE_COST,
      }),
    };
  }

  it('sends the Copilot bearer and editor-identification headers, and parses a successful completion', async () => {
    const { provider, calls } = providerWithToken(() => ({
      status: 200,
      body: copilotChatCompletionSuccessFixture,
    }));

    const response = await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.message.content).toBe('Hello from Copilot!');
    expect(response.finishReason).toBe('stop');
    expect(response.usage.costUsd).toBeCloseTo(
      (10 / 1_000_000) * 4 + (6 / 1_000_000) * 16,
    );

    const chatCall = calls.find((c) => c.url.endsWith('/chat/completions'));
    expect(chatCall?.headers.authorization).toBe(
      'Bearer tid=fixture-copilot-bearer;exp=1752003600',
    );
    expect(chatCall?.headers['copilot-integration-id']).toBe('vscode-chat');
    expect(chatCall?.headers['editor-version']).toBeTruthy();
    expect(chatCall?.url).toBe('https://api.githubcopilot.com/chat/completions');
  });

  it('surfaces truncation via finishReason "length"', async () => {
    const { provider } = providerWithToken(() => ({
      status: 200,
      body: copilotChatCompletionTruncatedFixture,
    }));

    const response = await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'write a long essay' }],
    });
    expect(response.finishReason).toBe('length');
  });

  it('defaults costUsd to 0 when no costTable entry is configured (flat-fee subscription, see file header)', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? { status: 200, body: copilotTokenSuccessFixture }
        : { status: 200, body: copilotChatCompletionSuccessFixture },
    );
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    const response = await provider.chat({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.usage.costUsd).toBe(0);
  });

  it('throws CopilotSubscriptionError with remediation text on a 403 from the chat-completions call itself', async () => {
    const { provider } = providerWithToken(() => ({
      status: 403,
      statusText: 'Forbidden',
      body: { message: 'model not permitted for this plan' },
    }));

    const err = await provider
      .chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopilotSubscriptionError);
    expect((err as CopilotSubscriptionError).remediation).toMatch(
      /github\.com\/settings\/copilot/,
    );
  });

  it('throws ProviderRateLimitError on 429 and parses Retry-After', async () => {
    const { provider } = providerWithToken(() => ({
      status: copilotRateLimitFixture.status,
      statusText: copilotRateLimitFixture.statusText,
      body: JSON.parse(copilotRateLimitFixture.body),
      headers: { 'retry-after': copilotRateLimitFixture.retryAfterHeader },
    }));

    const err = await provider
      .chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as ProviderRateLimitError).retryAfterMs).toBe(3000);
  });

  it('throws ProviderHttpError on 500', async () => {
    const { provider } = providerWithToken(() => ({
      status: copilotServerErrorFixture.status,
      statusText: copilotServerErrorFixture.statusText,
      body: JSON.parse(copilotServerErrorFixture.body),
    }));

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderHttpError);
  });

  it('throws ProviderResponseShapeError when usage is missing', async () => {
    const { provider } = providerWithToken(() => ({
      status: 200,
      body: { ...copilotChatCompletionSuccessFixture, usage: undefined },
    }));

    await expect(
      provider.chat({ model: 'gpt-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderResponseShapeError);
  });
});

describe('CopilotProvider — listModels() / getContextLength()', () => {
  it('parses the models list and applies configured context lengths', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/copilot_internal/v2/token')
        ? { status: 200, body: copilotTokenSuccessFixture }
        : { status: 200, body: copilotModelsListFixture },
    );
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
      contextLengths: { 'gpt-5.1': 128_000 },
    });

    const models = await provider.listModels();
    expect(models).toEqual([
      { id: 'gpt-5.1', contextLength: 128_000 },
      { id: 'claude-opus-4.8' },
    ]);
    expect(await provider.getContextLength('gpt-5.1')).toBe(128_000);
    expect(await provider.getContextLength('unknown')).toBeUndefined();
  });
});

describe('CopilotProvider — health() / warmUp() / queueStats()', () => {
  it('reports "ok" when the token exchange succeeds', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: copilotTokenSuccessFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    const health = await provider.health();
    expect(health.status).toBe('ok');
  });

  it('reports "error" with the CopilotSubscriptionError message as detail', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: copilotTokenForbiddenFixture.status,
      statusText: copilotTokenForbiddenFixture.statusText,
      body: JSON.parse(copilotTokenForbiddenFixture.body),
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    const health = await provider.health();
    expect(health.status).toBe('error');
    expect(health.detail).toMatch(/subscription does not include API\/chat access/);
  });

  it('reports "unreachable" when the endpoint cannot be reached', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    const health = await provider.health();
    expect(health.status).toBe('unreachable');
  });

  it('warmUp() delegates to health()', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: copilotTokenSuccessFixture,
    }));
    const provider = createCopilotProvider({
      fetchImpl,
      credentialStore: inMemoryCredentialStore({
        [DEFAULT_COPILOT_CREDENTIAL_REF]: 'ghu_stored',
      }),
    });

    expect((await provider.warmUp()).status).toBe('ok');
  });

  it('queueStats() reports concurrency from config', () => {
    const provider = createCopilotProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      credentialStore: inMemoryCredentialStore(),
      concurrency: 2,
    });
    expect(provider.queueStats()).toEqual({ active: 0, queued: 0, concurrency: 2 });
  });
});

describe('factory', () => {
  it('createCopilotProvider defaults id to "copilot"', () => {
    const provider = createCopilotProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      credentialStore: inMemoryCredentialStore(),
    });
    expect(provider.id).toBe('copilot');
  });
});
