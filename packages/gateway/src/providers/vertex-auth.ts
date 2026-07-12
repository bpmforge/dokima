/**
 * Vertex AI Application Default Credentials (ADC) chain (D-007, TECH_STACK.md
 * "Vertex auth = ADC, not API keys"): resolves a short-lived OAuth2 access
 * token the same way `google-auth-library`'s `GoogleAuth` does — explicit
 * service-account JSON ref first, then `GOOGLE_APPLICATION_CREDENTIALS`, then
 * the well-known `gcloud auth application-default login` file — without
 * depending on that library. packages/gateway/package.json is outside this
 * ticket's write_scope (`packages/gateway/src/providers/vertex*`), so no npm
 * dependency can be added here — the same constraint W2-01/02/03 hit for
 * `openai`/`@anthropic-ai/sdk` (see anthropic.ts's file header). This hand-
 * rolls only what the library's ADC path actually does: read a credentials
 * JSON file, then exchange it at Google's token endpoint for a bearer token
 * (RS256 JWT-bearer for a service account, or a refresh-token grant for
 * gcloud user credentials) — never a hand-rolled bespoke protocol. A future
 * ticket that owns package.json can swap this for the real library without
 * changing VertexProvider's public surface.
 *
 * ADC discovery order verified 2026-07-12 via WebFetch against
 * docs.cloud.google.com/docs/authentication/application-default-credentials
 * (GOOGLE_APPLICATION_CREDENTIALS, then the well-known gcloud file at
 * `~/.config/gcloud/application_default_credentials.json` POSIX /
 * `%APPDATA%\gcloud\application_default_credentials.json` Windows) and the
 * two credential JSON shapes (`type: "service_account"` with
 * `client_email`/`private_key`/`token_uri`; `type: "authorized_user"` with
 * `client_id`/`client_secret`/`refresh_token`). The explicit service-account
 * JSON ref (a pre-resolved secret string, FR-S2 — same convention as
 * anthropic.ts's/openai.ts's `apiKey`) is checked first, satisfying the
 * ticket acceptance's "service-account JSON ref" half independently of any
 * file on disk.
 *
 * JWT-bearer flow (header/claims/signing/token-exchange shape) verified
 * 2026-07-12 via WebFetch against
 * developers.google.com/identity/protocols/oauth2/service-account: RS256
 * over `{header}.{claims}` base64url segments, `iss`=client_email,
 * `scope`='https://www.googleapis.com/auth/cloud-platform' (the broad scope
 * Vertex AI calls require), `aud`=the key's token_uri (falls back to
 * Google's public token endpoint), 1-hour `exp`; POSTed to the token
 * endpoint as `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&
 * assertion=<jwt>`. Signing uses node:crypto's built-in RSA-SHA256 signer —
 * no external crypto/JWT library needed, and the docs explicitly say RS256
 * is the only algorithm Google's OAuth2 server accepts, so nothing here is
 * guessed.
 *
 * "Absence of ADC = provider shows 'not configured', never a crash at call
 * time" (TECH_STACK.md trap): resolveAdcCredentials() never throws — a
 * VertexProvider constructed before Vertex is configured for a project
 * stays constructible; the caller only sees a typed ProviderAuthError
 * rejection (not an uncaught crash) the first time it actually tries to
 * chat/health-check.
 */
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ProviderAuthError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';

export interface ServiceAccountKey {
  type: 'service_account';
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export interface AuthorizedUserCredentials {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export type AdcCredentials = ServiceAccountKey | AuthorizedUserCredentials;

export interface CachedVertexToken {
  accessToken: string;
  expiresAtMs: number;
}

/** Mutable per-provider auth state, held by the one VertexProvider instance that owns it (same shape as copilot.ts's CopilotRuntime). */
export interface VertexAuthRuntime {
  id: string;
  serviceAccountJson?: string;
  credentialsFilePath?: string;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  now: () => number;
  cachedToken?: CachedVertexToken;
}

const OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const JWT_LIFETIME_SECONDS = 3600;
/** Refresh a bit before actual expiry so a call never races a token that dies mid-flight (same convention as copilot.ts's TOKEN_REFRESH_BUFFER_MS). */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64url');
}

function wellKnownAdcPath(): string {
  return process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'gcloud', 'application_default_credentials.json')
    : join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

async function readCredentialsFile(path: string): Promise<AdcCredentials | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as AdcCredentials;
  } catch {
    return undefined;
  }
}

/** Never throws (see file header) — undefined means "not configured", not an error. */
export async function resolveAdcCredentials(
  runtime: VertexAuthRuntime,
): Promise<AdcCredentials | undefined> {
  if (runtime.serviceAccountJson) {
    return JSON.parse(runtime.serviceAccountJson) as AdcCredentials;
  }
  const explicitPath =
    runtime.credentialsFilePath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicitPath) {
    return readCredentialsFile(explicitPath);
  }
  return readCredentialsFile(wellKnownAdcPath());
}

/** RS256 JWT-bearer assertion for a service-account key (see file header for the verified claim shape). */
export function signServiceAccountJwt(key: ServiceAccountKey, now: () => number): string {
  const iat = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: key.token_uri ?? OAUTH_TOKEN_URI,
      iat,
      exp: iat + JWT_LIFETIME_SECONDS,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(key.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

interface TokenEndpointResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

async function exchangeToken(
  runtime: VertexAuthRuntime,
  tokenUri: string,
  params: Record<string, string>,
): Promise<TokenEndpointResponse> {
  let response: Response;
  try {
    response = await runtime.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(runtime.requestTimeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ProviderTimeoutError(runtime.id, runtime.requestTimeoutMs);
    }
    throw new ProviderUnreachableError(runtime.id, err);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProviderAuthError(runtime.id, response.status, response.statusText, body);
  }
  return (await response.json()) as TokenEndpointResponse;
}

/** Resolves ADC + exchanges it for a bearer token, caching until near expiry. */
export async function ensureVertexAccessToken(
  runtime: VertexAuthRuntime,
): Promise<string> {
  if (
    runtime.cachedToken &&
    runtime.cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > runtime.now()
  ) {
    return runtime.cachedToken.accessToken;
  }

  const credentials = await resolveAdcCredentials(runtime);
  if (!credentials) {
    throw new ProviderAuthError(
      runtime.id,
      401,
      'Unauthorized',
      'no Application Default Credentials found — set GOOGLE_APPLICATION_CREDENTIALS to a ' +
        'service-account key file, run `gcloud auth application-default login`, or supply a ' +
        'service-account JSON credential ref',
    );
  }

  const tokenUri =
    credentials.type === 'service_account'
      ? (credentials.token_uri ?? OAUTH_TOKEN_URI)
      : OAUTH_TOKEN_URI;
  const response =
    credentials.type === 'service_account'
      ? await exchangeToken(runtime, tokenUri, {
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: signServiceAccountJwt(credentials, runtime.now),
        })
      : await exchangeToken(runtime, tokenUri, {
          grant_type: 'refresh_token',
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          refresh_token: credentials.refresh_token,
        });

  if (!response.access_token || response.expires_in === undefined) {
    throw new ProviderResponseShapeError(
      runtime.id,
      'token endpoint response is missing access_token/expires_in',
    );
  }
  runtime.cachedToken = {
    accessToken: response.access_token,
    expiresAtMs: runtime.now() + response.expires_in * 1000,
  };
  return runtime.cachedToken.accessToken;
}
