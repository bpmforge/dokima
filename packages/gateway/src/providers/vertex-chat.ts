/**
 * Vertex AI Gemini `generateContent`/`countTokens` wire format (D-007):
 * verified 2026-07-12 via WebFetch against
 * docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
 * (request `contents[].role`/`parts[].text`, `systemInstruction`,
 * `generationConfig.{temperature,maxOutputTokens,stopSequences}`; response
 * `candidates[].content.{role,parts}`/`finishReason`, `usageMetadata.
 * {promptTokenCount,candidatesTokenCount,totalTokenCount}`) and
 * docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/count-tokens
 * (`countTokens` — same request shape, `{totalTokens}` response). Gemini
 * uses `model` (not OpenAI/Anthropic's `assistant`) for the assistant role
 * in `contents`.
 */
import { ProviderResponseShapeError, ProviderUnsupportedRoleError } from './errors.js';
import type { ChatRequest, ChatResponse, FinishReason } from './types.js';
import { normalizeUsage, type CostTable } from './usage.js';

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

interface CountTokensResponse {
  totalTokens?: number;
}

function mapRole(role: 'user' | 'assistant'): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

/**
 * Refuses a 'tool'-role message (W11-15, FR-G9): Gemini carries tool
 * results as `functionResponse` parts, not text parts, and this function
 * only ever builds `{ text }` parts — mapping 'tool' through `mapRole` here
 * would silently mis-serialize a tool result as plain user text. Real
 * Gemini tool-result wire support is separate, later, design-heavy work;
 * this only refuses rather than mis-serializing.
 *
 * `ChatRole` does not carry 'tool' yet (that's W11-12's own write_scope, not
 * this ticket's), so the loop below allowlists 'user'/'assistant' — the only
 * roles `mapRole` accepts — and refuses everything else by name instead of
 * matching on the 'tool' literal, so the refusal keeps working, unwidened,
 * once 'tool' actually joins the union.
 */
export function buildGenerateContentBody(request: ChatRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of request.messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new ProviderUnsupportedRoleError('vertex', message.role);
    }
    contents.push({ role: mapRole(message.role), parts: [{ text: message.content }] });
  }

  const generationConfig: Record<string, unknown> = {};
  if (request.temperature !== undefined)
    generationConfig.temperature = request.temperature;
  if (request.maxTokens !== undefined)
    generationConfig.maxOutputTokens = request.maxTokens;
  if (request.stop?.length) generationConfig.stopSequences = request.stop;

  return {
    contents,
    ...(systemParts.length
      ? { systemInstruction: { parts: [{ text: systemParts.join('\n\n') }] } }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };
}

function normalizeFinishReason(raw: string | undefined): FinishReason {
  switch (raw) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

export function parseGenerateContentResponse(
  providerId: string,
  modelId: string,
  raw: unknown,
  costTable: CostTable,
): ChatResponse {
  const body = raw as GenerateContentResponse;
  const candidate = body.candidates?.[0];
  if (!candidate?.content) {
    throw new ProviderResponseShapeError(
      providerId,
      'response has no candidates[0].content',
    );
  }
  if (
    body.usageMetadata?.promptTokenCount === undefined ||
    body.usageMetadata?.candidatesTokenCount === undefined
  ) {
    throw new ProviderResponseShapeError(
      providerId,
      'response is missing usageMetadata — cannot meter this call (FR-G1 requires normalized usage)',
    );
  }

  const text = (candidate.content.parts ?? []).map((part) => part.text ?? '').join('');

  return {
    model: modelId,
    message: { role: 'assistant', content: text },
    finishReason: normalizeFinishReason(candidate.finishReason),
    usage: normalizeUsage(
      {
        promptTokens: body.usageMetadata.promptTokenCount,
        completionTokens: body.usageMetadata.candidatesTokenCount,
      },
      modelId,
      costTable,
    ),
  };
}

/** Minimal request for the free countTokens reachability probe (see vertex.ts's health()). */
export function buildCountTokensBody(): Record<string, unknown> {
  return { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] };
}

export function parseCountTokensResponse(providerId: string, raw: unknown): number {
  const body = raw as CountTokensResponse;
  if (body.totalTokens === undefined) {
    throw new ProviderResponseShapeError(
      providerId,
      'countTokens response is missing totalTokens',
    );
  }
  return body.totalTokens;
}
