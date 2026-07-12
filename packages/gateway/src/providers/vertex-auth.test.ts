import { describe, expect, it } from 'vitest';
import { ProviderAuthError } from './errors.js';
import { authorizedUserCredentialsFixture } from './vertex-fixtures.js';
import {
  ensureVertexAccessToken,
  type VertexAuthClientFactory,
  type VertexAuthClientOptions,
  type VertexAuthRuntime,
} from './vertex-auth.js';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const FIXTURE_TOKEN = 'ya29.fixture-access-token';

const SERVICE_ACCOUNT_JSON = {
  type: 'service_account',
  client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n',
  project_id: 'fixture-project',
};

/**
 * A network-free stand-in for `GoogleAuth` (docs/TESTING.md §2/§7): records the
 * options it was constructed with and returns a fixed token (or throws), so the
 * tests exercise vertex-auth's real credential-path selection and error mapping
 * without ever hitting Google's token endpoint.
 */
function fakeAuth(opts: { token?: string | null; error?: Error } = {}): {
  factory: VertexAuthClientFactory;
  captured: VertexAuthClientOptions[];
  clientCount: () => number;
} {
  const captured: VertexAuthClientOptions[] = [];
  let clients = 0;
  const factory: VertexAuthClientFactory = (options) => {
    captured.push(options);
    clients += 1;
    return {
      getAccessToken: async () => {
        if (opts.error) throw opts.error;
        return opts.token === undefined ? FIXTURE_TOKEN : opts.token;
      },
    };
  };
  return { factory, captured, clientCount: () => clients };
}

function runtime(overrides: Partial<VertexAuthRuntime> = {}): VertexAuthRuntime {
  return { id: 'vertex', ...overrides };
}

describe('ensureVertexAccessToken — credential path selection', () => {
  it('passes an explicit serviceAccountJson ref to GoogleAuth as parsed credentials', async () => {
    const { factory, captured } = fakeAuth();
    const token = await ensureVertexAccessToken(
      runtime({
        serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_JSON),
        authClientFactory: factory,
      }),
    );
    expect(token).toBe(FIXTURE_TOKEN);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.scopes).toBe(CLOUD_PLATFORM_SCOPE);
    expect(captured[0]?.credentials).toEqual(SERVICE_ACCOUNT_JSON);
    expect(captured[0]?.keyFilename).toBeUndefined();
  });

  it('passes an authorized_user credential ref through as credentials (GoogleAuth runs the refresh-token grant)', async () => {
    const { factory, captured } = fakeAuth();
    await ensureVertexAccessToken(
      runtime({
        serviceAccountJson: JSON.stringify(authorizedUserCredentialsFixture),
        authClientFactory: factory,
      }),
    );
    expect(captured[0]?.credentials).toEqual(authorizedUserCredentialsFixture);
  });

  it('passes credentialsFilePath as keyFilename when no serviceAccountJson is given', async () => {
    const { factory, captured } = fakeAuth();
    await ensureVertexAccessToken(
      runtime({ credentialsFilePath: '/tmp/adc.json', authClientFactory: factory }),
    );
    expect(captured[0]?.keyFilename).toBe('/tmp/adc.json');
    expect(captured[0]?.credentials).toBeUndefined();
  });

  it('falls back to bare ADC discovery (scopes only) when nothing is configured', async () => {
    const { factory, captured } = fakeAuth();
    await ensureVertexAccessToken(runtime({ authClientFactory: factory }));
    expect(captured[0]).toEqual({ scopes: CLOUD_PLATFORM_SCOPE });
  });
});

describe('ensureVertexAccessToken — caching and error mapping', () => {
  it('reuses one auth client across calls so the library keeps its internal token cache', async () => {
    const { factory, clientCount } = fakeAuth();
    const rt = runtime({
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT_JSON),
      authClientFactory: factory,
    });
    await ensureVertexAccessToken(rt);
    await ensureVertexAccessToken(rt);
    expect(clientCount()).toBe(1);
  });

  it('maps a malformed serviceAccountJson ref to ProviderAuthError, not an uncaught SyntaxError', async () => {
    const { factory } = fakeAuth();
    await expect(
      ensureVertexAccessToken(
        runtime({ serviceAccountJson: '{ not json', authClientFactory: factory }),
      ),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('maps a token-acquisition failure to ProviderAuthError — never a crash', async () => {
    const { factory } = fakeAuth({ error: new Error('ENOENT: no credentials file') });
    await expect(
      ensureVertexAccessToken(
        runtime({
          credentialsFilePath: '/does/not/exist.json',
          authClientFactory: factory,
        }),
      ),
    ).rejects.toThrow(ProviderAuthError);
  });

  it('rejects with ProviderAuthError when GoogleAuth yields an empty token (not configured)', async () => {
    const { factory } = fakeAuth({ token: null });
    await expect(
      ensureVertexAccessToken(runtime({ authClientFactory: factory })),
    ).rejects.toThrow(ProviderAuthError);
  });
});
