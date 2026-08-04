/**
 * Structural validation for the provider registry (W10-01).
 *
 * Pure: no I/O, no secret patterns. Every refusal carries a machine-readable
 * `rule` so the API can explain itself rather than returning a bare 400 — the
 * same discipline the board uses for drag refusals (FR-C4, "drag-refusals
 * explained").
 */

import {
  CONSENT_GATED_KINDS,
  ENDPOINT_KINDS,
  PROVIDER_KINDS,
  ProviderRegistryError,
  type ProviderEntry,
  type ProviderKind,
} from './types.js';

/** `id` is a settings-file key and a matrix routing target — keep it boring. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isKind(value: unknown): value is ProviderKind {
  return (
    typeof value === 'string' && (PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Validates one entry's shape. Throws `ProviderRegistryError` with a named
 * rule on the first violation — callers surface `rule` to the user.
 *
 * `consentedKinds` lists kinds the caller has an existing ledgered
 * acknowledgement for (D-019). Absent it, a consent-gated kind is refused
 * outright: this function can NEVER be the path by which Copilot gets
 * silently enabled.
 */
export function validateProviderEntry(
  input: unknown,
  consentedKinds: readonly ProviderKind[] = [],
): ProviderEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProviderRegistryError('provider entry must be an object', 'entry-shape');
  }
  const v = input as Record<string, unknown>;

  if (typeof v.id !== 'string' || !ID_RE.test(v.id)) {
    throw new ProviderRegistryError(
      'provider id must be lowercase alphanumeric with dashes, 1-64 chars',
      'invalid-id',
    );
  }
  if (!isKind(v.kind)) {
    throw new ProviderRegistryError(
      `provider kind must be one of: ${PROVIDER_KINDS.join(', ')}`,
      'invalid-kind',
    );
  }

  const needsEndpoint = (ENDPOINT_KINDS as readonly string[]).includes(v.kind);
  if (needsEndpoint && (typeof v.baseUrl !== 'string' || v.baseUrl.trim() === '')) {
    throw new ProviderRegistryError(
      `kind "${v.kind}" addresses a user-supplied endpoint and requires baseUrl`,
      'missing-base-url',
    );
  }
  if (v.requestTimeoutMs !== undefined) {
    // A timeout that never fires is not a timeout (W10-57 acceptance 5), so a
    // non-positive or non-integer value is refused rather than coerced.
    if (
      typeof v.requestTimeoutMs !== 'number' ||
      !Number.isInteger(v.requestTimeoutMs) ||
      v.requestTimeoutMs <= 0
    ) {
      throw new ProviderRegistryError(
        `requestTimeoutMs must be a positive integer (ms), got ${JSON.stringify(v.requestTimeoutMs)}`,
        'invalid-request-timeout',
      );
    }
  }

  if (v.baseUrl !== undefined && typeof v.baseUrl !== 'string') {
    throw new ProviderRegistryError('baseUrl must be a string', 'invalid-base-url');
  }
  if (typeof v.baseUrl === 'string' && v.baseUrl.trim() !== '') {
    let parsed: URL;
    try {
      parsed = new URL(v.baseUrl);
    } catch {
      throw new ProviderRegistryError(
        `baseUrl is not a valid URL: ${v.baseUrl}`,
        'invalid-base-url',
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ProviderRegistryError(
        'baseUrl must be http(s)',
        'invalid-base-url-scheme',
      );
    }
  }

  if (v.credentialRef !== undefined && typeof v.credentialRef !== 'string') {
    throw new ProviderRegistryError(
      'credentialRef must be a string naming a keychain entry',
      'invalid-credential-ref',
    );
  }

  if (typeof v.enabled !== 'boolean') {
    throw new ProviderRegistryError('enabled must be a boolean', 'invalid-enabled');
  }

  if (
    v.enabled &&
    (CONSENT_GATED_KINDS as readonly string[]).includes(v.kind) &&
    !consentedKinds.includes(v.kind)
  ) {
    throw new ProviderRegistryError(
      `kind "${v.kind}" requires an explicit, ledgered consent acknowledgement before it can be enabled (D-019)`,
      'consent-required',
    );
  }

  const entry: ProviderEntry = {
    id: v.id,
    kind: v.kind,
    enabled: v.enabled,
    ...(typeof v.baseUrl === 'string' && v.baseUrl.trim() !== ''
      ? { baseUrl: v.baseUrl }
      : {}),
    ...(typeof v.credentialRef === 'string' ? { credentialRef: v.credentialRef } : {}),
    // W10-57. This construction is an ALLOWLIST — a field validated above but
    // omitted here is silently dropped, which is how the entry would have gone
    // out settable and inert.
    ...(typeof v.requestTimeoutMs === 'number'
      ? { requestTimeoutMs: v.requestTimeoutMs }
      : {}),
  };
  return entry;
}

/** Validates a whole registry, additionally refusing duplicate ids. */
export function validateProviderRegistry(
  input: unknown,
  consentedKinds: readonly ProviderKind[] = [],
): ProviderEntry[] {
  if (!Array.isArray(input)) {
    throw new ProviderRegistryError('registry must be an array', 'registry-shape');
  }
  const entries = input.map((item) => validateProviderEntry(item, consentedKinds));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new ProviderRegistryError(
        `duplicate provider id: ${entry.id}`,
        'duplicate-id',
      );
    }
    seen.add(entry.id);
  }
  return entries;
}
