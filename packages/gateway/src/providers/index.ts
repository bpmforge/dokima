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
  createLmStudioProvider,
  createOaiCompatProvider,
  createOllamaProvider,
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
