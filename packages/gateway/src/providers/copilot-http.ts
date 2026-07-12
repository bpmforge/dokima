/** Low-level HTTP plumbing shared by every Copilot endpoint: timeout/network classification and generic status→error mapping. */
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';

/** Retry-After per RFC 9110 §10.2.3 (same logic as oai-compat.ts; not exported there, so duplicated — see index.ts re: write_scope). */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

/** Builds the {fetchRaw, throwHttpError} pair a CopilotRuntime carries, bound to one provider id + fetch implementation. */
export function createHttpFns(
  id: string,
  fetchImpl: typeof fetch,
): {
  fetchRaw: (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;
  throwHttpError: (response: Response) => Promise<never>;
} {
  return {
    async fetchRaw(url, init, timeoutMs) {
      try {
        return await fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new ProviderTimeoutError(id, timeoutMs);
        }
        throw new ProviderUnreachableError(id, err);
      }
    },

    /** Generic HTTP-status classifier for endpoints with no Copilot-subscription semantics of their own (the device-flow endpoints). */
    async throwHttpError(response) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(id, response.status, response.statusText, body);
      }
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        throw new ProviderRateLimitError(
          id,
          response.status,
          response.statusText,
          body,
          retryAfterMs,
        );
      }
      throw new ProviderHttpError(id, response.status, response.statusText, body);
    },
  };
}
