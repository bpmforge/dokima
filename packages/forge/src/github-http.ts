/** Low-level HTTP plumbing shared by every GitHub endpoint chapter: auth headers, timeout/network classification, and status->error mapping. */
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
import { GITHUB_API_VERSION, type GitHubRuntime } from './github-types.js';

/** Retry-After per RFC 9110 §10.2.3 (seconds or HTTP-date), same logic as gateway's copilot-http.ts. */
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

/** Falls back to x-ratelimit-reset (epoch seconds) when no Retry-After header is present — GitHub's primary-limit signal. */
function parseRateLimitResetMs(headers: Headers, now: () => number): number | undefined {
  const resetHeader = headers.get('x-ratelimit-reset');
  if (!resetHeader) return undefined;
  const resetSeconds = Number(resetHeader);
  if (!Number.isFinite(resetSeconds)) return undefined;
  return Math.max(0, resetSeconds * 1000 - now());
}

export function buildGitHubHeaders(
  token: string,
  apiVersion: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': apiVersion,
    'User-Agent': 'shipwright-forge',
  };
}

export function resolveToken(runtime: GitHubRuntime, identity: ForgeIdentity): string {
  if (identity === 'reviewer') {
    if (!runtime.reviewerToken) throw new ForgeIdentityError(runtime.id, 'reviewer');
    return runtime.reviewerToken;
  }
  return runtime.makerToken;
}

/** Builds the {fetchRaw, throwHttpError} pair a GitHubRuntime carries, bound to one adapter id + fetch implementation. */
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
     * GitHub's rate-limit signal is a 403 or 429 either way (verified via
     * "Rate limits for the REST API"), disambiguated from a plain
     * permission-denied 403 (e.g. HP-6: no admin rights for branch
     * protection) by the presence of retry-after or an exhausted
     * x-ratelimit-remaining budget.
     */
    async throwHttpError(response) {
      const body = await response.text().catch(() => '');
      const isRateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('retry-after') !== null ||
            response.headers.get('x-ratelimit-remaining') === '0'));

      if (isRateLimited) {
        const retryAfterMs =
          parseRetryAfterMs(response.headers.get('retry-after'), now) ??
          parseRateLimitResetMs(response.headers, now);
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

/** Issues one authenticated GitHub REST call and parses the JSON body; a non-2xx response throws via runtime.throwHttpError. */
export async function requestGitHubApi<T>(
  runtime: GitHubRuntime,
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
        ...buildGitHubHeaders(token, runtime.apiVersion),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
    timeoutMs,
  );
  if (!response.ok) await runtime.throwHttpError(response);
  return (await response.json()) as T;
}

/** Same as requestGitHubApi but tolerates a 404 by returning undefined instead of throwing (used by the drift validator). */
export async function requestGitHubApiOrNotFound<T>(
  runtime: GitHubRuntime,
  path: string,
  timeoutMs: number,
  identity: ForgeIdentity = 'maker',
): Promise<T | undefined> {
  const token = runtime.tokenFor(identity);
  const response = await runtime.fetchRaw(
    `${runtime.apiBaseUrl}${path}`,
    { method: 'GET', headers: buildGitHubHeaders(token, runtime.apiVersion) },
    timeoutMs,
  );
  if (response.status === 404) return undefined;
  if (!response.ok) await runtime.throwHttpError(response);
  return (await response.json()) as T;
}

export { GITHUB_API_VERSION };
