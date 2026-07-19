import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization: object keys sorted recursively so two
 * calls carrying the same data in different key order hash identically.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * sha256 hex digest of a value's canonical JSON form (FR-I3, SC-12: the
 * audited tool-call event carries an args digest + result digest, never the
 * raw args/result — the event log stays small and the values themselves
 * still go through `appendEvent`'s redaction only where a caller chooses to
 * store them, e.g. the human-readable `approval.requested` card).
 */
export function digestOf(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
