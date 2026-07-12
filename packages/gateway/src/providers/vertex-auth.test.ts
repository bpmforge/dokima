import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProviderAuthError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
} from './errors.js';
import {
  authorizedUserCredentialsFixture,
  tokenInvalidGrantFixture,
  tokenSuccessFixture,
} from './vertex-fixtures.js';
import {
  ensureVertexAccessToken,
  resolveAdcCredentials,
  signServiceAccountJwt,
  type ServiceAccountKey,
  type VertexAuthRuntime,
} from './vertex-auth.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const SERVICE_ACCOUNT_KEY: ServiceAccountKey = {
  type: 'service_account',
  client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
  private_key: privateKey,
  project_id: 'fixture-project',
  token_uri: 'https://oauth2.googleapis.com/token',
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(
  handler: (call: Call) => { status: number; statusText?: string; body: unknown },
  calls: Call[] = [],
): { fetchImpl: typeof fetch; calls: Call[] } {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: typeof input === 'string' ? input : input.toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: (init?.body as string) ?? '',
    };
    calls.push(call);
    const result = handler(call);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      statusText: result.statusText,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function runtime(overrides: Partial<VertexAuthRuntime> = {}): VertexAuthRuntime {
  return {
    id: 'vertex',
    fetchImpl: fetch,
    requestTimeoutMs: 5_000,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('signServiceAccountJwt', () => {
  it('produces a valid RS256 JWT with the documented claim shape', () => {
    const now = () => 1_700_000_000_000;
    const jwt = signServiceAccountJwt(SERVICE_ACCOUNT_KEY, now);
    const [headerB64, claimsB64, sigB64] = jwt.split('.');
    expect(headerB64).toBeDefined();
    expect(claimsB64).toBeDefined();
    expect(sigB64).toBeDefined();

    const header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });

    const claims = JSON.parse(Buffer.from(claimsB64!, 'base64url').toString('utf8'));
    expect(claims.iss).toBe(SERVICE_ACCOUNT_KEY.client_email);
    expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
    expect(claims.aud).toBe(SERVICE_ACCOUNT_KEY.token_uri);
    expect(claims.iat).toBe(1_700_000_000);
    expect(claims.exp).toBe(1_700_000_000 + 3600);

    const signature = Buffer.from(sigB64!, 'base64url');
    const verified = createVerify('RSA-SHA256')
      .update(`${headerB64}.${claimsB64}`)
      .verify(publicKey, signature);
    expect(verified).toBe(true);
  });
});

describe('resolveAdcCredentials', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vertex-adc-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers an explicit serviceAccountJson ref over any file', async () => {
    const credentials = await resolveAdcCredentials(
      runtime({ serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_KEY) }),
    );
    expect(credentials).toEqual(SERVICE_ACCOUNT_KEY);
  });

  it('reads GOOGLE_APPLICATION_CREDENTIALS-equivalent explicit file path', async () => {
    const filePath = join(tempDir, 'sa.json');
    await writeFile(filePath, JSON.stringify(authorizedUserCredentialsFixture));
    const credentials = await resolveAdcCredentials(
      runtime({ credentialsFilePath: filePath }),
    );
    expect(credentials).toEqual(authorizedUserCredentialsFixture);
  });

  it('resolves to undefined — never throws — when nothing is configured', async () => {
    const filePath = join(tempDir, 'missing.json');
    const credentials = await resolveAdcCredentials(
      runtime({ credentialsFilePath: filePath }),
    );
    expect(credentials).toBeUndefined();
  });
});

describe('ensureVertexAccessToken', () => {
  it('exchanges a service-account JWT for an access token and caches it', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: tokenSuccessFixture,
    }));
    const rt = runtime({
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_KEY),
      fetchImpl,
    });

    const token = await ensureVertexAccessToken(rt);
    expect(token).toBe(tokenSuccessFixture.access_token);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(calls[0]?.body);
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(params.get('assertion')).toBeTruthy();

    // Cached: second call makes no new request.
    const token2 = await ensureVertexAccessToken(rt);
    expect(token2).toBe(tokenSuccessFixture.access_token);
    expect(calls).toHaveLength(1);
  });

  it('exchanges an authorized_user refresh token via grant_type=refresh_token', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: tokenSuccessFixture,
    }));
    const rt = runtime({
      serviceAccountJson: JSON.stringify(authorizedUserCredentialsFixture),
      fetchImpl,
    });

    await ensureVertexAccessToken(rt);
    const params = new URLSearchParams(calls[0]?.body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('client_id')).toBe(authorizedUserCredentialsFixture.client_id);
    expect(params.get('client_secret')).toBe(
      authorizedUserCredentialsFixture.client_secret,
    );
    expect(params.get('refresh_token')).toBe(
      authorizedUserCredentialsFixture.refresh_token,
    );
  });

  it('refreshes once the cached token is within the refresh buffer of expiry', async () => {
    let now = 1_700_000_000_000;
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: tokenSuccessFixture,
    }));
    const rt = runtime({
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_KEY),
      fetchImpl,
      now: () => now,
    });

    await ensureVertexAccessToken(rt);
    expect(calls).toHaveLength(1);

    now += tokenSuccessFixture.expires_in * 1000 - 30_000; // inside the 60s refresh buffer
    await ensureVertexAccessToken(rt);
    expect(calls).toHaveLength(2);
  });

  it('rejects with ProviderAuthError — not a crash — when ADC is not configured', async () => {
    await expect(
      ensureVertexAccessToken(runtime({ credentialsFilePath: '/does/not/exist.json' })),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('classifies a token-endpoint failure as ProviderAuthError', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: tokenInvalidGrantFixture.status,
      statusText: tokenInvalidGrantFixture.statusText,
      body: JSON.parse(tokenInvalidGrantFixture.body),
    }));
    const rt = runtime({
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_KEY),
      fetchImpl,
    });
    await expect(ensureVertexAccessToken(rt)).rejects.toThrow(ProviderAuthError);
  });

  it('throws ProviderResponseShapeError when the token response is missing access_token', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { expires_in: 3600 } }));
    const rt = runtime({
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_KEY),
      fetchImpl,
    });
    await expect(ensureVertexAccessToken(rt)).rejects.toThrow(ProviderResponseShapeError);
  });

  it('classifies a timeout as ProviderTimeoutError', async () => {
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    }) as typeof fetch;
    const rt = runtime({
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_KEY),
      fetchImpl,
      requestTimeoutMs: 5,
    });
    await expect(ensureVertexAccessToken(rt)).rejects.toThrow(ProviderTimeoutError);
  });
});
