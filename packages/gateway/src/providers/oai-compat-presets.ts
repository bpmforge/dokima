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

/** LM Studio local server — defaults to its documented default port (docs/TECH_STACK.md). */
export function createLmStudioProvider(config: Partial<OaiCompatConfig> = {}): Provider {
  return createOaiCompatProvider({
    id: 'lm-studio',
    baseUrl: LM_STUDIO_DEFAULT_BASE_URL,
    concurrency: 1,
    ...config,
  });
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
