/** Typed HTTP failures from a provider endpoint, classified so callers (escalation ladder, W3-07 limit-parking) can branch without re-parsing status codes. */
export class ProviderHttpError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`${providerId}: request failed with ${status} ${statusText}`);
    this.name = 'ProviderHttpError';
  }
}

export class ProviderAuthError extends ProviderHttpError {
  constructor(providerId: string, status: number, statusText: string, body: string) {
    super(providerId, status, statusText, body);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderRateLimitError extends ProviderHttpError {
  constructor(
    providerId: string,
    status: number,
    statusText: string,
    body: string,
    public readonly retryAfterMs?: number,
  ) {
    super(providerId, status, statusText, body);
    this.name = 'ProviderRateLimitError';
  }
}

/** Response reached us but did not carry the fields we need (e.g. missing usage) — never silently metered as zero. */
export class ProviderResponseShapeError extends Error {
  constructor(providerId: string, detail: string) {
    super(`${providerId}: unexpected response shape — ${detail}`);
    this.name = 'ProviderResponseShapeError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(providerId: string, timeoutMs: number) {
    super(`${providerId}: request timed out after ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderUnreachableError extends Error {
  constructor(providerId: string, cause: unknown) {
    super(`${providerId}: endpoint unreachable — ${String(cause)}`);
    this.name = 'ProviderUnreachableError';
    this.cause = cause;
  }
}
