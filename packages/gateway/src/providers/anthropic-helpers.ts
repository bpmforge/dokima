/**
 * Anthropic wire-shape helpers (W2-02, book-style split — see anthropic.ts's
 * file header): stop-reason normalization, system-prompt splitting,
 * retry-after parsing, and SSE-level error classification.
 */
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderUnsupportedRoleError,
} from './errors.js';
import type { ChatMessage, FinishReason } from './types.js';

export function normalizeStopReason(raw: string | null): FinishReason {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/** Retry-After per RFC 9110 §10.2.3 (same logic as oai-compat.ts; not exported there, so duplicated — see anthropic.ts header re: write_scope). */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

/**
 * Anthropic carries the system prompt in a top-level field, never inside the
 * messages array. Refuses a 'tool'-role message (W11-15, FR-G9): Anthropic
 * sends tool results as `tool_result` content blocks carrying `tool_use_id`
 * INSIDE a user-role message, and this function's return shape has nowhere
 * to put that id — mapping 'tool' onto plain user text here would silently
 * drop it. Real tool-result wire support is separate, later, design-heavy
 * work; this only refuses rather than mis-serializing.
 *
 * `ChatRole` does not carry 'tool' yet (that's W11-12's own write_scope, not
 * this ticket's), so the loop below allowlists 'user'/'assistant' and
 * refuses everything else by name instead of matching on the 'tool' literal
 * — the refusal keeps working, unwidened, once 'tool' actually joins the
 * union.
 */
export function splitSystem(messages: ChatMessage[]): {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemParts: string[] = [];
  const rest: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'user' || m.role === 'assistant') {
      rest.push({ role: m.role, content: m.content });
      continue;
    }
    throw new ProviderUnsupportedRoleError('anthropic', m.role);
  }
  return {
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    messages: rest,
  };
}

/** Maps Anthropic's SSE-level `error` event (no HTTP status) onto the same typed errors as an HTTP failure. */
export function classifyStreamError(
  id: string,
  error: { type: string; message: string },
): Error {
  const body = JSON.stringify(error);
  switch (error.type) {
    case 'authentication_error':
      return new ProviderAuthError(id, 401, 'Unauthorized', body);
    case 'permission_error':
      return new ProviderAuthError(id, 403, 'Forbidden', body);
    case 'rate_limit_error':
      return new ProviderRateLimitError(id, 429, 'Too Many Requests', body);
    case 'overloaded_error':
      // "would normally correspond to an HTTP 529" per platform.claude.com/docs/en/build-with-claude/streaming —
      // same back-off-and-retry contract as a rate limit.
      return new ProviderRateLimitError(id, 529, 'Overloaded', body);
    default:
      return new ProviderHttpError(id, 500, 'Internal Server Error', body);
  }
}
