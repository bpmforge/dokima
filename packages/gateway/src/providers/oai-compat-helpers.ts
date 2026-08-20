/**
 * OpenAI-compatible wire-shape helpers (book-style split — see
 * oai-compat.ts's file header): finish-reason normalization and
 * retry-after parsing.
 */
import { normalizeToolCalls } from './types.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatRole,
  FinishReason,
  RawToolCall,
} from './types.js';
import { normalizeUsage, type CostTable } from './usage.js';
import type { RawChatCompletionResponse } from './oai-compat-types.js';

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

/**
 * Shapes one OpenAI-compatible `choices[0]` into a normalized `ChatResponse`.
 *
 * Extracted from `oai-compat.ts` when W13-42 pushed that file over the
 * 400-line cap — a move, not a rewrite. The seam is real either way: this is
 * wire-shape normalisation, and what it was extracted from is transport and
 * queueing.
 */
export function toChatResponse(
  providerId: string,
  request: ChatRequest,
  raw: RawChatCompletionResponse,
  choice: NonNullable<RawChatCompletionResponse['choices']>[number],
  costTable: CostTable,
): ChatResponse {
  const modelId = raw.model ?? request.model;
  const rawToolCalls = (choice.message as unknown as { tool_calls?: RawToolCall[] })
    .tool_calls;
  return {
    model: modelId,
    message: {
      role: choice.message.role as ChatRole,
      content: choice.message.content ?? '',
    },
    finishReason: normalizeFinishReason(choice.finish_reason),
    usage: normalizeUsage(
      {
        promptTokens: raw.usage!.prompt_tokens,
        completionTokens: raw.usage!.completion_tokens,
      },
      modelId,
      costTable,
    ),
    ...(rawToolCalls !== undefined
      ? { toolCalls: normalizeToolCalls(providerId, rawToolCalls) }
      : {}),
  };
}
