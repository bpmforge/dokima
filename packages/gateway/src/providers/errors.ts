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

/**
 * A `ChatMessage` role this adapter has no wire representation for (FR-G9,
 * W11-15) — thrown instead of silently mis-serializing the turn (e.g.
 * mapping a 'tool'-role result onto plain user text and dropping its call
 * id). Refusal only: real Anthropic/Gemini tool-result wire support is
 * separate, later, design-heavy work, not delivered by this error existing.
 */
export class ProviderUnsupportedRoleError extends Error {
  constructor(
    public readonly adapter: string,
    public readonly role: string,
  ) {
    super(
      `${adapter}: cannot serialize a '${role}'-role message onto its wire format — refusing rather than mis-serializing one (real tool-result wire support is separate, later work)`,
    );
    this.name = 'ProviderUnsupportedRoleError';
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
