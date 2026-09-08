/**
 * The one gateway pool, and the one endpoint identity (W23-06, AB-06).
 *
 * FR-F3's "process-wide" was already literal for MAKER sessions:
 * `run-build-spawn.ts` held a module-level `GatewayPool` that every session,
 * rung and berth shared. Nothing else did. The review pass constructed its own
 * provider and called `chat` directly, and so did the onboard specialist
 * dispatch — so a local endpoint that serves one request at a time could be
 * asked for three at once the moment a review or an analysis overlapped a
 * build. The limit was real and it covered one third of the traffic.
 *
 * ONE INSTANCE, IMPORTED — never constructed per call. A pool built inside a
 * function is a limit that only limits its own caller, which is the shape this
 * card exists to remove; `sharedGatewayPool()` returns the same object every
 * time and there is no exported constructor.
 *
 * ENDPOINT IDENTITY IS NORMALIZED, because two roles pointed at the same
 * server through different spellings must share its limit. `http://localhost:1234`
 * and `http://LOCALHOST:1234/` are one endpoint; a trailing slash, a case
 * difference in the host, a default port written out, and a stray path suffix
 * are all spellings, not servers.
 *
 * AND IT CARRIES NO SECRETS. A base URL can arrive with credentials in its
 * userinfo or a token in its query string, and an endpoint id ends up in logs,
 * metrics and (through `queueStats`) the UI. Both are stripped, so the key is
 * scheme + host + port + path and nothing else (FR-S2).
 */

import { GatewayPool, type Provider } from '@dokima/gateway';

/**
 * The process-wide pool. One active request per endpoint by default, which is
 * the honest default for a local model server: assuming a cloud endpoint
 * accepts unlimited concurrent work is how a rate limit becomes a run failure
 * (AB-06 step 3). A capable endpoint can be given a validated higher limit
 * through `GatewayPool`'s own `endpointConcurrency`, which this module
 * deliberately does not surface as a global — that is per-endpoint
 * configuration, not a process-wide dial.
 */
const POOL = new GatewayPool();

export function sharedGatewayPool(): GatewayPool {
  return POOL;
}

/**
 * The pool key for one endpoint. Two aliases of one server produce one key;
 * two genuinely different servers never collide.
 *
 * `providerId` is part of the key on purpose: two provider KINDS pointed at
 * the same host are still two different services in every way that matters to
 * a queue (different auth, different models, different rate limits), and
 * merging them would throttle one because the other is busy.
 */
export function endpointIdFor(target: {
  readonly providerId?: string | null;
  readonly baseUrl?: string | null;
}): string {
  const providerId = (target.providerId ?? 'unknown').trim().toLowerCase();
  const raw = (target.baseUrl ?? '').trim();
  if (raw === '') return `${providerId}:`;

  try {
    const url = new URL(raw);
    // Credentials never reach a pool key: it is logged, surfaced in queue
    // stats, and lives as long as the process.
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const host = url.hostname.toLowerCase();
    const port = url.port === '' ? '' : `:${url.port}`;
    const path = url.pathname.replace(/\/+$/, '');
    return `${providerId}:${url.protocol}//${host}${port}${path}`;
  } catch {
    // Not a URL at all. Normalize what can be normalized rather than throwing:
    // an unparseable base URL is a configuration problem the provider will
    // report far better than a queue key can.
    return `${providerId}:${raw.toLowerCase().replace(/\/+$/, '')}`;
  }
}

/**
 * Wraps a provider so its `chat` goes through the shared pool exactly once.
 *
 * ONE ACQUISITION PER REAL REQUEST (AB-06 step 4): only `chat` is wrapped.
 * `listModels`, `getContextLength`, `health`, `warmUp` and `queueStats` pass
 * straight through — a scheduler is not reentrant, and a health probe taken
 * from inside a queued chat would deadlock on the slot the chat is holding.
 *
 * The slot is released by `FairScheduler` in its own `finally`, so a chat that
 * throws, times out or is cancelled cannot leak an active count. The test
 * beside this file asserts that with a rejecting provider rather than
 * assuming it.
 */
export function pooledProvider(
  raw: Provider,
  endpointId: string,
  projectId: string,
): Provider {
  return {
    id: raw.id,
    chat: (request) => POOL.run(endpointId, projectId, () => raw.chat(request)),
    listModels: () => raw.listModels(),
    getContextLength: (model) => raw.getContextLength(model),
    health: () => raw.health(),
    warmUp: () => raw.warmUp(),
    queueStats: () => raw.queueStats(),
  };
}
