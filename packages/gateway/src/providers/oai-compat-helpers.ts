/**
 * OpenAI-compatible wire-shape helpers (book-style split — see
 * oai-compat.ts's file header): finish-reason normalization and
 * retry-after parsing.
 */
import type { FinishReason } from './types.js';

export function normalizeFinishReason(raw: string | null): FinishReason {
  switch (raw) {
    case 'stop':
    case 'length':
    case 'content_filter':
    case 'tool_calls':
      return raw;
    default:
      return 'unknown';
  }
}

/** Retry-After per RFC 9110 §10.2.3: either delay-seconds or an HTTP-date. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}
