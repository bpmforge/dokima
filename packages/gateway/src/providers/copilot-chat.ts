/** Chat-completions + models wire parsing — the OpenAI-compatible shape GitHub proxies Copilot models through. */
import { ProviderResponseShapeError } from './errors.js';
import { normalizeUsage, type CostTable } from './usage.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatRole,
  FinishReason,
  ModelInfo,
} from './types.js';
import type { RawChatCompletionResponse, RawModelsResponse } from './copilot-types.js';

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

export function buildChatRequestBody(request: ChatRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    ...(request.stop !== undefined ? { stop: request.stop } : {}),
  };
}

export function parseChatCompletion(
  providerId: string,
  raw: RawChatCompletionResponse,
  request: ChatRequest,
  costTable: CostTable,
): ChatResponse {
  const choice = raw.choices?.[0];
  if (!choice) {
    throw new ProviderResponseShapeError(providerId, 'response has no choices[0]');
  }
  if (!raw.usage) {
    throw new ProviderResponseShapeError(
      providerId,
      'response is missing usage — cannot meter this call (FR-G1 requires normalized usage)',
    );
  }
  const modelId = raw.model ?? request.model;
  return {
    model: modelId,
    message: {
      role: choice.message.role as ChatRole,
      content: choice.message.content ?? '',
    },
    finishReason: normalizeFinishReason(choice.finish_reason),
    usage: normalizeUsage(
      {
        promptTokens: raw.usage.prompt_tokens,
        completionTokens: raw.usage.completion_tokens,
      },
      modelId,
      costTable,
    ),
  };
}

export function parseModelsList(
  raw: RawModelsResponse,
  contextLengths: Record<string, number>,
): ModelInfo[] {
  return raw.data.map((m) => ({
    id: m.id,
    ...(contextLengths[m.id] !== undefined
      ? { contextLength: contextLengths[m.id] }
      : {}),
  }));
}
