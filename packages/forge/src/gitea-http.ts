/** Low-level HTTP plumbing shared by every Gitea endpoint chapter: auth headers, timeout/network classification, and status->error mapping. */
import {
  ForgeAuthError,
  ForgeHttpError,
  ForgeIdentityError,
  ForgeNotFoundError,
  ForgeRateLimitError,
  ForgeTimeoutError,
  ForgeUnreachableError,
  ForgeValidationError,
  type ForgeIdentity,
} from './types.js';
import type { GiteaRuntime } from './gitea-types.js';

/** Retry-After per RFC 9110 §10.2.3 (seconds or HTTP-date), same logic as github-http.ts. */
export function parseRetryAfterMs(
  header: string | null,
  now: () => number,
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now());
}

/** `Authorization: token <api_key>` — Gitea's documented header format, distinct from GitHub's `Bearer`. */
export function buildGiteaHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/json',
    'User-Agent': 'dokima-forge',
  };
}

export function resolveToken(runtime: GiteaRuntime, identity: ForgeIdentity): string {
  if (identity === 'reviewer') {
    if (!runtime.reviewerToken) throw new ForgeIdentityError(runtime.id, 'reviewer');
    return runtime.reviewerToken;
  }
  return runtime.makerToken;
}

/** Builds the {fetchRaw, throwHttpError} pair a GiteaRuntime carries, bound to one adapter id + fetch implementation. */
export function createHttpFns(
  id: string,
  fetchImpl: typeof fetch,
  now: () => number,
): {
  fetchRaw: (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;
  throwHttpError: (response: Response) => Promise<never>;
} {
  return {
    async fetchRaw(url, init, timeoutMs) {
      try {
        return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new ForgeTimeoutError(id, timeoutMs);
        }
        throw new ForgeUnreachableError(id, err);
      }
    },

    /**
     * Gitea's REST API has no native rate-limit signal (no
     * x-ratelimit-remaining, unlike GitHub) — a 429 only shows up if a
     * reverse proxy in front of the instance emits one, so it's
     * disambiguated purely by status code + an optional Retry-After.
     */
    async throwHttpError(response) {
      const body = await response.text().catch(() => '');

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), now);
        throw new ForgeRateLimitError(
          id,
          response.status,
          response.statusText,
          body,
          retryAfterMs,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new ForgeAuthError(id, response.status, response.statusText, body);
      }
      if (response.status === 404) {
        throw new ForgeNotFoundError(id, response.status, response.statusText, body);
      }
      if (response.status === 422) {
        throw new ForgeValidationError(id, response.status, response.statusText, body);
      }
      throw new ForgeHttpError(id, response.status, response.statusText, body);
    },
  };
}

/** Issues one authenticated Gitea REST call and parses the JSON body; a non-2xx response throws via runtime.throwHttpError. */
export async function requestGiteaApi<T>(
  runtime: GiteaRuntime,
  path: string,
  init: { method: string; body?: string },
  timeoutMs: number,
  identity: ForgeIdentity = 'maker',
): Promise<T> {
  const token = runtime.tokenFor(identity);
  const response = await runtime.fetchRaw(
    `${runtime.apiBaseUrl}${path}`,
    {
      method: init.method,
      body: init.body,
      headers: {
        ...buildGiteaHeaders(token),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
    timeoutMs,
  );
  if (!response.ok) await runtime.throwHttpError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Same as requestGiteaApi but tolerates a 404 by returning undefined instead of throwing (used by the drift validator). */
export async function requestGiteaApiOrNotFound<T>(
  runtime: GiteaRuntime,
  path: string,
  timeoutMs: number,
  identity: ForgeIdentity = 'maker',
): Promise<T | undefined> {
  const token = runtime.tokenFor(identity);
  const response = await runtime.fetchRaw(
    `${runtime.apiBaseUrl}${path}`,
    { method: 'GET', headers: buildGiteaHeaders(token) },
    timeoutMs,
  );
  if (response.status === 404) return undefined;
  if (!response.ok) await runtime.throwHttpError(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
