/**
 * vitest.network-guard.ts — Law 9(a), enforced instead of remembered.
 *
 * CLAUDE.md law 9(a): "tests and CI use recorded fixtures and the fake-model
 * gateway — never live API calls". That was a rule in a document, and nothing
 * checked it. W13-18's route tests called a real LM Studio on 127.0.0.1:1234
 * for a day — `resolveModelTarget` falls back to `envTarget`, whose documented
 * default is exactly that address (model-resolution.ts:261) — and I wrote them
 * while quoting the law.
 *
 * They did not fail as "you called a live model". They passed, because the
 * model loaded that day answered inside the 5s default timeout, and resurfaced
 * a day later as an unrelated-looking timeout once a slower one was loaded.
 * A live call in a test is not merely impure: it makes the suite report the
 * machine's state as if it were the code's.
 *
 * WHAT IS REFUSED, AND WHY IT IS NARROW. The first cut of this file refused
 * every un-stubbed `fetch` and turned 52 tests red. Those tests were right and
 * the guard was wrong: they boot a Fastify app on an OS-assigned port and talk
 * to it over loopback, which is hermetic — the process under test *is* the
 * server. Refusing them enforced "no sockets", which is not the law.
 *
 * The law is about live *model* calls, so that is the line drawn here:
 *
 *   - any non-loopback host — a real cloud API, the failure the law names;
 *   - loopback on 1234 or 11434 — LM Studio and Ollama, the two local model
 *     daemons the product defaults to (oai-compat.ts:377-378). A test cannot
 *     have started these: they are a daemon the developer happens to be
 *     running, which is exactly what made W13-18 pass and then fail.
 *
 * Anything else on loopback is a server the test itself brought up, and is
 * allowed. A test that stubs `fetch` never reaches this at all — which is the
 * intended path, and why the guard costs nothing.
 *
 * Same shape as `apps/server/vitest.setup.ts` (W10-71), which pins
 * `DOKIMA_HOME` because inheriting the developer's real home turned `main` red
 * four tests later. Both say: the machine must not leak into a suite.
 */
import { afterEach, beforeEach } from 'vitest';

const realFetch = globalThis.fetch;

/** The local model daemons the product defaults to. Not test-startable. */
const MODEL_DAEMON_PORTS = new Set(['1234', '11434']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export function isForbiddenTestUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false; // not an absolute http(s) URL; nothing to judge
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!LOOPBACK.has(url.hostname)) return true;
  return MODEL_DAEMON_PORTS.has(url.port);
}

function refuse(url: string): never {
  throw new Error(
    `law 9(a): this test tried to reach ${url}.\n\n` +
      `  Tests use recorded fixtures and the fake-model gateway — never live\n` +
      `  API calls. A suite that reaches a real model reports the machine's\n` +
      `  state as if it were the code's: it passes on the day a fast model is\n` +
      `  loaded, then fails later for reasons that look unrelated.\n\n` +
      `  Stub it:  globalThis.fetch = (async () => new Response(...)) as typeof fetch\n\n` +
      `  (Loopback on a port your own test started is allowed and never\n` +
      `  reaches this message — only cloud hosts and the LM Studio / Ollama\n` +
      `  daemon ports 1234 and 11434 are refused.)`,
  );
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string })?.url ?? String(input);
}

beforeEach(() => {
  const passthrough = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = urlOf(input);
    if (isForbiddenTestUrl(url)) refuse(url);
    return (passthrough as (a: unknown, b: unknown) => unknown)(input, init);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});
