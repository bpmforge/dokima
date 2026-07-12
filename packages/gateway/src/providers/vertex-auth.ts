/**
 * Vertex AI Application Default Credentials (ADC, D-007, TECH_STACK.md "Vertex
 * auth = ADC, not API keys"): acquires a short-lived OAuth2 access token via
 * `google-auth-library`'s `GoogleAuth`, the library TECH_STACK.md L121-125
 * mandates ("Use `google-auth-library`'s `GoogleAuth`/ADC chain … tokens
 * auto-refresh via the library; never hand-roll JWT signing"). `GoogleAuth`
 * owns the whole credential resolution + token flow: an explicit
 * service-account JSON ref, else `GOOGLE_APPLICATION_CREDENTIALS`, else the
 * well-known `gcloud auth application-default login` file, else the GCE
 * metadata server — signing the RS256 JWT-bearer assertion for a
 * service-account key or running the refresh-token grant for a gcloud user
 * credential, and caching/refreshing the token internally. We never touch a
 * private key or the token endpoint ourselves.
 *
 * SCOPE / DEPENDENCY NOTE (read before "why is this in root package.json?"):
 * this ticket's write_scope is `packages/gateway/src/providers/vertex*`, which
 * excludes `packages/gateway/package.json`. The conductor's out-of-scope gate
 * (scripts/conductor.mjs ALWAYS_OK) blesses the *root* `package.json` +
 * `pnpm-lock.yaml` for any ticket but not a nested package's package.json, so
 * `google-auth-library` is declared in the root `package.json` (pnpm hoists it;
 * it resolves here via the normal upward node_modules walk). ARCHITECTURE law 2
 * ("provider SDKs in packages/gateway only") is honored in substance: this
 * library is imported *only* from `vertex*.ts` — no other package reaches for
 * it. HANDOFF: relocate the dependency into `packages/gateway/package.json`
 * (matching every other package's per-package `dependencies`, e.g.
 * packages/events → better-sqlite3) once a ticket owns that file.
 *
 * The `GoogleAuth` client is created behind an injectable factory
 * (`authClientFactory`) so contract tests exercise token acquisition against a
 * fake client — never the network (docs/TESTING.md §2/§7, CLAUDE.md Law 9).
 *
 * "Absence of ADC = provider shows 'not configured', never a crash at call
 * time" (TECH_STACK.md trap): `GoogleAuth` construction is lazy (no I/O), and
 * every failure path here — a malformed service-account JSON ref, a missing
 * credential, or a token-acquisition error — surfaces as a typed
 * ProviderAuthError rejection the first time a caller actually chats or
 * health-checks, never an uncaught throw at construction.
 */
import { GoogleAuth } from 'google-auth-library';
import type { JWTInput } from 'google-auth-library';
import { ProviderAuthError } from './errors.js';

/** The one method vertex-auth needs from an auth client; `GoogleAuth` satisfies it structurally, and tests supply a fake. */
export interface VertexAuthClient {
  getAccessToken(): Promise<string | null | undefined>;
}

export interface VertexAuthClientOptions {
  scopes: string;
  /** Parsed service-account or authorized_user credential JSON (explicit ref). */
  credentials?: JWTInput;
  /** Path to a credential file, overriding ADC discovery. */
  keyFilename?: string;
}

export type VertexAuthClientFactory = (
  options: VertexAuthClientOptions,
) => VertexAuthClient;

/** Mutable per-provider auth state, held by the one VertexProvider instance that owns it. */
export interface VertexAuthRuntime {
  id: string;
  /** Pre-resolved service-account (or authorized_user) key JSON string — the "service-account JSON ref" acceptance path (FR-S2). */
  serviceAccountJson?: string;
  /** Overrides GOOGLE_APPLICATION_CREDENTIALS / well-known ADC discovery; mainly for tests. */
  credentialsFilePath?: string;
  /** Override the auth client construction (tests inject a network-free fake); defaults to `GoogleAuth`. */
  authClientFactory?: VertexAuthClientFactory;
  /** Lazily created + reused so the library's internal token cache persists across calls. */
  client?: VertexAuthClient;
}

/** The broad scope Vertex AI calls require (docs.cloud.google.com/vertex-ai — cloud-platform). */
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const defaultAuthClientFactory: VertexAuthClientFactory = (options) =>
  new GoogleAuth({
    scopes: options.scopes,
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.keyFilename ? { keyFilename: options.keyFilename } : {}),
  });

/** Parses the explicit service-account JSON ref; a malformed ref is an auth error, not an uncaught SyntaxError (never-throws-at-config contract). */
function parseServiceAccountJson(runtime: VertexAuthRuntime, json: string): JWTInput {
  try {
    return JSON.parse(json) as JWTInput;
  } catch {
    throw new ProviderAuthError(
      runtime.id,
      401,
      'Unauthorized',
      'serviceAccountJson credential ref is not valid JSON',
    );
  }
}

function buildAuthClientOptions(runtime: VertexAuthRuntime): VertexAuthClientOptions {
  if (runtime.serviceAccountJson) {
    return {
      scopes: CLOUD_PLATFORM_SCOPE,
      credentials: parseServiceAccountJson(runtime, runtime.serviceAccountJson),
    };
  }
  if (runtime.credentialsFilePath) {
    return { scopes: CLOUD_PLATFORM_SCOPE, keyFilename: runtime.credentialsFilePath };
  }
  // No explicit ref: let GoogleAuth run the full ADC discovery chain
  // (GOOGLE_APPLICATION_CREDENTIALS → well-known gcloud file → GCE metadata).
  return { scopes: CLOUD_PLATFORM_SCOPE };
}

function getOrCreateClient(runtime: VertexAuthRuntime): VertexAuthClient {
  if (runtime.client) return runtime.client;
  const factory = runtime.authClientFactory ?? defaultAuthClientFactory;
  runtime.client = factory(buildAuthClientOptions(runtime));
  return runtime.client;
}

/**
 * Resolves a bearer token for the Vertex REST endpoint. `GoogleAuth` handles
 * credential discovery, JWT signing, token exchange, caching and refresh; we
 * only translate its failure modes into the Provider error contract. Any
 * failure (missing/unreadable ADC, a token-endpoint rejection, a transient
 * network error during acquisition) is an auth-time problem → ProviderAuthError,
 * never an uncaught throw.
 */
export async function ensureVertexAccessToken(
  runtime: VertexAuthRuntime,
): Promise<string> {
  let token: string | null | undefined;
  try {
    token = await getOrCreateClient(runtime).getAccessToken();
  } catch (err) {
    if (err instanceof ProviderAuthError) throw err;
    throw new ProviderAuthError(
      runtime.id,
      401,
      'Unauthorized',
      `failed to acquire Application Default Credentials token: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!token) {
    throw new ProviderAuthError(
      runtime.id,
      401,
      'Unauthorized',
      'no Application Default Credentials found — set GOOGLE_APPLICATION_CREDENTIALS to a ' +
        'service-account key file, run `gcloud auth application-default login`, or supply a ' +
        'service-account JSON credential ref',
    );
  }
  return token;
}
