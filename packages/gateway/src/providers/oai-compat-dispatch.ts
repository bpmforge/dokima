/**
 * providers/oai-compat-dispatch.ts — the long-call dispatcher (P6-15).
 * Chapter of oai-compat.ts, split under the 400-line CODE_BOOK_PROTOCOL cap.
 *
 * Live guided-sample field trace 2026-09-01: a `requestTimeoutMs` above 300s
 * was a silent lie — Node's undici client enforces its own 300s
 * `headersTimeout` BENEATH the request's AbortSignal, so a 27b grinding a
 * large context died at ~5 minutes with `fetch failed <- HeadersTimeoutError`
 * no matter what W10-57's knob said. Above undici's default, calls carry a
 * dedicated Agent whose headers/body timeouts track the configured value
 * (idle streams stay bounded by streamIdleMs). One Agent per provider,
 * created lazily, cached for the provider's life.
 */
import type { Agent } from 'undici';

const UNDICI_DEFAULT_HEADERS_TIMEOUT_MS = 300_000;

export function createLongCallDispatcherCache(): (
  timeoutMs: number,
) => Promise<Agent | undefined> {
  let agent: Agent | undefined;
  return async (timeoutMs: number) => {
    if (timeoutMs <= UNDICI_DEFAULT_HEADERS_TIMEOUT_MS) return undefined;
    if (!agent) {
      const { Agent: UndiciAgent } = await import('undici');
      agent = new UndiciAgent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    }
    return agent;
  };
}
