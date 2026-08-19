export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatRole,
  FinishReason,
  ModelInfo,
  NormalizedUsage,
  Provider,
  ProviderHealth,
  ProviderHealthStatus,
  ProviderQueueStats,
} from './types.js';

export {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
  isProviderError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';

export { RequestQueue } from './request-queue.js';

export {
  LOCAL_COST_TABLE,
  normalizeUsage,
  type CostTable,
  type ModelPrice,
  type RawUsage,
} from './usage.js';

export {
  OaiCompatProvider,
  createOaiCompatProvider,
  type OaiCompatConfig,
} from './oai-compat.js';

export {
  AnthropicProvider,
  createAnthropicProvider,
  type AnthropicConfig,
} from './anthropic.js';

export {
  COPILOT_OAUTH_CLIENT_ID,
  CopilotDeviceAuthError,
  CopilotProvider,
  CopilotSubscriptionError,
  DEFAULT_COPILOT_CREDENTIAL_REF,
  createCopilotProvider,
  type CopilotConfig,
  type CopilotCredentialStore,
  type DeviceCodeInfo,
  type DevicePollResult,
} from './copilot.js';

/**
 * W12-26: the device flow, exported so an HTTP surface can drive it.
 * `copilot-device-auth.ts` has been complete and tested since the adapter
 * landed and had no reachable caller — the same unexported-mechanism shape as
 * W12-04's packer barrel and W12-11's OpenAI adapter. Its own doc comment even
 * names the route that was meant to call it and says the poll cadence belongs
 * to that caller, which is exactly what the server now owns.
 */
export {
  requestDeviceCode,
  pollDeviceAuthorization,
} from './copilot-device-auth.js';
export { createHttpFns } from './copilot-http.js';
export type { CopilotRuntime } from './copilot-types.js';

export { VertexProvider, createVertexProvider, type VertexConfig } from './vertex.js';

/**
 * W12-11: openai.ts shipped complete — OpenAiProvider, createOpenAiProvider,
 * OpenAiConfig — and was the ONLY provider missing from this barrel, so the
 * adapter was unreachable from outside the package since it was written.
 * Found by trying to construct it. W12-10's no-callers validator could not
 * have caught this: it reports EXPORTED symbols nothing calls, and an
 * unexported module is invisible to it — the exact limitation recorded in
 * that ticket's own STATUS entry, confirmed one ticket later.
 */
export { OpenAiProvider, createOpenAiProvider, type OpenAiConfig } from './openai.js';
// W13-22: split out of oai-compat.ts, which was at the 400-line cap.
export { createLmStudioProvider, createOllamaProvider } from './oai-compat-presets.js';
