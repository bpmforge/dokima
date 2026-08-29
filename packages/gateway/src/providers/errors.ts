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

/**
 * A call that ran past its ceiling — and WHICH model ran past it (W22-07).
 *
 * The message used to be "lm-studio: request timed out after 300000ms", which
 * names the host and not the thing that was slow. C-4 means a user always has
 * at least two models configured — a maker and a distinct reviewer — so being
 * told to "pick a faster model" without being told WHICH of the two ran long
 * leaves them guessing between the two halves of their own setup. Measured
 * live 2026-08-28 against LM Studio serving both.
 *
 * `model` is OPTIONAL and degrades honestly: a throw site that does not know
 * the model (the request-queue wait in `asProviderTimeout`, a provider whose
 * failure happens before a model is chosen) omits it rather than inventing
 * one, and the message is then exactly what it always was.
 */
export class ProviderTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
    public readonly model?: string,
  ) {
    super(
      `${providerId}${model === undefined ? '' : ` (model ${model})`}: ` +
        `request timed out after ${timeoutMs}ms`,
    );
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * The REASON a connection failed, dug out of the nested cause.
 *
 * `String(err)` on a failed `fetch` flattens to "TypeError: fetch failed" and
 * throws away everything that distinguishes the cases: nothing listening
 * (ECONNREFUSED), a socket dropped mid-request (UND_ERR_SOCKET), or the
 * client's own header/body deadline expiring (UND_ERR_HEADERS_TIMEOUT). Those
 * want different actions from the user, and the flattened string made them
 * identical — the product told someone to "start the provider" while their
 * provider was up and serving.
 */
function describeCause(cause: unknown): string {
  const parts: string[] = [];
  let node: unknown = cause;
  for (let depth = 0; node instanceof Error && depth < 4; depth += 1) {
    const code = (node as { code?: unknown }).code;
    parts.push(typeof code === 'string' ? `${node.name}: ${node.message} [${code}]` : `${node.name}: ${node.message}`);
    node = (node as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(' <- ') : String(cause);
}

export class ProviderUnreachableError extends Error {
  constructor(providerId: string, cause: unknown) {
    super(`${providerId}: endpoint unreachable — ${describeCause(cause)}`);
    this.name = 'ProviderUnreachableError';
    this.cause = cause;
  }
}

/**
 * Is this an endpoint failing, rather than our code being wrong? (W13-13)
 *
 * Found in live testing: a 27B model on local hardware exceeded the 300s
 * request timeout, `ProviderTimeoutError` propagated out of `runLandLoop`
 * uncaught, and the run died with a stack trace — after the session had
 * already produced correct, verified, committed work. A slow provider is an
 * EXPECTED condition for a product that guarantees local-only works (C-1,
 * D-024 option a); it should end the attempt, not the process.
 *
 * An explicit list rather than a name prefix or a shared base class: these
 * errors have no common ancestor, and matching on `name.startsWith('Provider')`
 * would silently start swallowing any future class that happens to be named
 * that way — including one that means we have a bug.
 */
export function isProviderError(error: unknown): boolean {
  return (
    error instanceof ProviderHttpError ||
    error instanceof ProviderTimeoutError ||
    error instanceof ProviderUnreachableError ||
    error instanceof ProviderResponseShapeError ||
    error instanceof ProviderUnsupportedRoleError
  );
}
