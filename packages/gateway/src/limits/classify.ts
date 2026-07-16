/**
 * Provider-error classifier (FR-G8): session/usage/rate-limit responses (429/529, quota/limit
 * messages) vs terminal ones. The typed-error branch reads `packages/gateway/src/providers/
 * errors.ts`'s classes directly — `ProviderRateLimitError` is always a limit; any other
 * `ProviderHttpError` (including `ProviderAuthError`, which extends it) is a limit only if its
 * status or body says so, terminal otherwise. The text branch exists for callers that only have
 * raw provider/CLI output to go on (no thrown typed error) — same regex `scripts/conductor.mjs`
 * already runs in production, ported for behavior parity (D-008).
 */

import { ProviderHttpError, ProviderRateLimitError } from '../providers/errors.js';
import { parseResetTimestamp } from './reset-time.js';
import type { ProviderErrorClassification } from './types.js';

const LIMIT_MESSAGE_RE =
  /(session limit|usage limit|rate.?limit|quota|overloaded|429|529)/i;

function classifyText(text: string, nowMs: number): ProviderErrorClassification {
  if (!LIMIT_MESSAGE_RE.test(text)) {
    return { class: 'terminal' };
  }
  const resumeAt = parseResetTimestamp(text, nowMs) ?? undefined;
  return { class: 'limit', resumeAt };
}

/**
 * Classifies a thrown provider error, a raw error-ish object, or raw provider/CLI output text.
 * `nowMs` anchors reset-time parsing (defaults to `Date.now()` — pass an injected value in
 * tests for determinism, TESTING.md §2).
 */
export function classifyProviderError(
  error: unknown,
  nowMs: number = Date.now(),
): ProviderErrorClassification {
  if (typeof error === 'string') {
    return classifyText(error, nowMs);
  }
  if (error instanceof ProviderRateLimitError) {
    const text = `${error.message} ${error.body}`;
    const stated = parseResetTimestamp(text, nowMs);
    const resumeAt =
      stated ??
      (error.retryAfterMs !== undefined
        ? new Date(nowMs + error.retryAfterMs).toISOString()
        : undefined);
    return { class: 'limit', resumeAt };
  }
  if (error instanceof ProviderHttpError) {
    const text = `${error.status} ${error.statusText} ${error.body}`;
    if (error.status === 429 || error.status === 529 || LIMIT_MESSAGE_RE.test(text)) {
      return { class: 'limit', resumeAt: parseResetTimestamp(text, nowMs) ?? undefined };
    }
    return { class: 'terminal' };
  }
  if (error instanceof Error) {
    return classifyText(error.message, nowMs);
  }
  return { class: 'terminal' };
}
