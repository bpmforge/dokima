/**
 * oai-compat-presets.ts — the two local model daemons, named.
 *
 * Split out of `oai-compat.ts` (W13-22), which sat at 398 of the 400-line cap:
 * every fix to the adapter hit the wall before it could carry its own
 * explanation, and shaving comments to fit is how a file stops saying why.
 * These are a distinct concern — default endpoints for the daemons this
 * product ships against — and depend on nothing else in the adapter.
 *
 * Their ports are also the two the law 9(a) test guard refuses
 * (`vitest.network-guard.ts`); keep the two lists in step.
 */
import type { Provider } from './types.js';
import { createOaiCompatProvider, type OaiCompatConfig } from './oai-compat.js';

const LM_STUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/** One entry of LM Studio's native `/api/v0/models`, which reports more than the OpenAI shape. */
interface LmStudioNativeModel {
  readonly id?: unknown;
  /** "llm" | "vlm" | "embeddings" — the field the OpenAI-shaped /v1/models does not carry. */
  readonly type?: unknown;
  readonly max_context_length?: unknown;
}

/**
 * Asks LM Studio what each model is FOR (W21-93).
 *
 * `/v1/models` is the OpenAI shape and carries only `id`, `object` and
 * `owned_by` — nothing about capability. LM Studio's own `/api/v0/models`
 * reports `type` per model, so the answer exists and we simply were not asking
 * for it. Measured 2026-08-28 on a real daemon: 23 vlm, 8 llm, 4 embeddings.
 *
 * It lives in the PRESET rather than the adapter because this is LM Studio
 * knowledge, not OpenAI-compatible knowledge — a generic endpoint has no such
 * route, and pretending otherwise is how a guess gets made.
 *
 * Native path, not a config field: the endpoint is on the ORIGIN, one level
 * above the `/v1` base URL. Any failure — wrong version, route absent,
 * unreachable, malformed — yields nothing rather than a guess, and the caller
 * keeps the OpenAI-shaped list with no `kind` at all.
 */
async function lmStudioModelKinds(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<Map<string, 'generative' | 'embedding'>> {
  const kinds = new Map<string, 'generative' | 'embedding'>();
  let url: string;
  try {
    url = new URL('/api/v0/models', baseUrl).toString();
  } catch {
    return kinds;
  }
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res.ok) return kinds;
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return kinds;
    for (const raw of body.data as LmStudioNativeModel[]) {
      if (typeof raw?.id !== 'string' || typeof raw.type !== 'string') continue;
      // Only these two are claims. Anything else LM Studio invents later is
      // left ABSENT rather than folded into "generative", because absence is
      // honest and a wrong claim is not.
      if (raw.type === 'embeddings') kinds.set(raw.id, 'embedding');
      else if (raw.type === 'llm' || raw.type === 'vlm') kinds.set(raw.id, 'generative');
    }
  } catch {
    return kinds;
  }
  return kinds;
}

/** LM Studio local server — defaults to its documented default port (docs/TECH_STACK.md). */
export function createLmStudioProvider(config: Partial<OaiCompatConfig> = {}): Provider {
  const baseUrl = config.baseUrl ?? LM_STUDIO_DEFAULT_BASE_URL;
  const provider = createOaiCompatProvider({
    id: 'lm-studio',
    baseUrl,
    concurrency: 1,
    ...config,
  });
  const fetchImpl = config.fetchImpl ?? fetch;
  /**
   * EXPLICIT DELEGATION, not `{ ...provider }`. `createOaiCompatProvider`
   * returns a CLASS INSTANCE, and spreading one copies own properties while
   * dropping every prototype method — so `chat` silently became undefined and
   * the guided-sample e2e failed with "gateway calls: {}", no model call ever
   * reaching the fixture. The unit tests passed throughout because they only
   * exercised `listModels`, the one method the spread happened to define.
   * Naming each method is duller and cannot fail that way.
   */
  const enriched: Provider = {
    id: provider.id,
    chat: (request) => provider.chat(request),
    listModels: async () => {
      const models = await provider.listModels();
      const kinds = await lmStudioModelKinds(baseUrl, fetchImpl);
      if (kinds.size === 0) return models;
      return models.map((m) => {
        const kind = kinds.get(m.id);
        return kind === undefined ? m : { ...m, kind };
      });
    },
    getContextLength: (modelId) => provider.getContextLength(modelId),
    health: () => provider.health(),
    warmUp: () => provider.warmUp(),
    queueStats: () => provider.queueStats(),
    ...(provider.chatStream
      ? { chatStream: (request) => provider.chatStream!(request) }
      : {}),
  };
  /**
   * Carry the adapter's own timeout fields onto the wrapper. They are not part
   * of the Provider interface, but W21-96's red fixture asserts on them as the
   * observable proof that a per-entry timeout reached the adapter — and that
   * proof should not evaporate just because a wrapper was introduced. The
   * wrapper delegating them keeps the guarantee checkable.
   */
  const internals = provider as unknown as Record<string, unknown>;
  for (const field of ['requestTimeoutMs', 'streamIdleMs']) {
    if (internals[field] !== undefined) {
      (enriched as unknown as Record<string, unknown>)[field] = internals[field];
    }
  }
  return enriched;
}

/** Ollama's OpenAI-compatibility layer — defaults to its documented default port. */
export function createOllamaProvider(config: Partial<OaiCompatConfig> = {}): Provider {
  return createOaiCompatProvider({
    id: 'ollama',
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    concurrency: 1,
    ...config,
  });
}
