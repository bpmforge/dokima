import { SECRET_PATTERNS } from './patterns.js';

function placeholder(category: string): string {
  return `[REDACTED:${category}]`;
}

/** Replaces every known live-credential shape (SECRET_PATTERNS) with a category placeholder. */
export function redactPatterns(text: string): string {
  let result = text;
  for (const { category, regex } of SECRET_PATTERNS) {
    result = result.replace(regex, placeholder(category));
  }
  return result;
}

const MIN_REDACTABLE_VALUE_LENGTH = 6;

/**
 * Replaces exact occurrences of known secret values (vault-registered
 * secrets, project `.env` values) — sorted longest-first so a short value
 * that happens to be a substring of a longer one never partially unmasks
 * it. Values under `MIN_REDACTABLE_VALUE_LENGTH` are skipped: too short to
 * usefully identify as a secret, and matching them would redact ordinary
 * text.
 */
export function redactValues(text: string, secretValues: readonly string[]): string {
  const values = [
    ...new Set(secretValues.filter((v) => v.length >= MIN_REDACTABLE_VALUE_LENGTH)),
  ].sort((a, b) => b.length - a.length);
  let result = text;
  for (const value of values) {
    result = result.split(value).join(placeholder('secret'));
  }
  return result;
}

/** Pattern-based redaction followed by exact-value redaction (SC-06). */
export function redactString(text: string, secretValues: readonly string[] = []): string {
  return redactValues(redactPatterns(text), secretValues);
}

/**
 * Deep-walks any JSON-shaped value (context packet, event payload) and
 * redacts every string leaf. Deliberately untyped-in/typed-out (`T`) so it
 * works on whatever shape a caller's context packet or event payload
 * happens to be, without this package importing those types.
 */
export function redactDeep<T>(value: T, secretValues: readonly string[] = []): T {
  if (typeof value === 'string') {
    return redactString(value, secretValues) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, secretValues)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(entry, secretValues);
    }
    return out as T;
  }
  return value;
}
