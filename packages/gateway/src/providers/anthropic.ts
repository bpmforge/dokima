/**
 * Anthropic Messages API adapter (FR-G1, W2-02): the native `/v1/messages`
 * wire format — distinct from the OpenAI-compatible shape oai-compat.ts
 * covers — where the system prompt is a top-level field, content is a list
 * of typed blocks, and streaming is Anthropic's own SSE event sequence
 * (message_start -> content_block_* -> message_delta -> message_stop), not
 * OpenAI's per-chunk delta format. Wire shapes verified 2026-07-11 via
 * WebFetch against platform.claude.com/docs/en/api/messages,
 * .../build-with-claude/streaming, and .../api/models-list — not training
 * data. Contract tests pin these shapes via recorded fixtures
 * (anthropic-fixtures.ts), never a live call (docs/TESTING.md).
 *
 * API key handling (FR-S2): `apiKey` must be a secret already resolved from
 * a credential ref (packages/shared's CredentialStore) by the caller — this
 * adapter never reads a keychain itself and never accepts a value straight
 * out of a settings file; packages/gateway/package.json is outside this
 * ticket's write_scope so it cannot add a dependency on packages/shared to
 * resolve refs directly (same constraint noted in W2-01's and W0-07's
 * HANDOFF notes in plan.json).
 *
 * Cost table is required, not defaulted: unlike local models
 * (usage.ts's LOCAL_COST_TABLE, genuinely $0), an unpriced cloud call would
 * silently under-report real spend rather than mis-report it as free — the
 * caller must supply verified per-model pricing.
 *
 * Streaming has two entry points sharing one SSE parse (`streamEvents`,
 * W2-09/G-23): the `stream` config toggle chat() has always had (aggregates
 * the same events chatOnce() would; unchanged behavior), and the new public
 * `chatStream()`, which yields delta events as they arrive and a final
 * event carrying the identical normalized ChatResponse — same metering, no
 * unmetered streamed call.
 *
 * Book-style split (file-size gate, 400-line cap): once this file exceeded
 * the cap it was split into flat sibling chapters — anthropic-types.ts
 * (config + wire shapes + constants) and anthropic-helpers.ts (stop-reason
 * normalization, system-prompt splitting, retry-after parsing, SSE-error
 * classification). Flat siblings (not an anthropic/ subdirectory) keep every
 * chapter inside the ticket's original `anthropic*` write_scope, matching
 * copilot.ts's precedent. This file is the barrel: the AnthropicProvider
 * class and its factory are the public surface.
 */
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';
import { RequestQueue } from './request-queue.js';
import { readSseDataLines, runQueuedStream } from './streaming.js';
import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderHealth,
  ProviderQueueStats,
} from './types.js';
import type { ChatStreamEvent } from '../types.js';
import { normalizeUsage, type CostTable } from './usage.js';
import {
  classifyStreamError,
  normalizeStopReason,
  parseRetryAfterMs,
  splitSystem,
} from './anthropic-helpers.js';
import {
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_CLOUD_CONCURRENCY,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './anthropic-types.js';
import type {
  AnthropicConfig,
  AnthropicMessageResponse,
  AnthropicModelsResponse,
  AnthropicStreamEvent,
} from './anthropic-types.js';

export type { AnthropicConfig } from './anthropic-types.js';

export class AnthropicProvider implements Provider {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly costTable: CostTable;
  private readonly contextLengths: Record<string, number>;
  private readonly defaultMaxTokens: number;
  private readonly streamEnabled: boolean;
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly queue: RequestQueue;

  constructor(config: AnthropicConfig) {
    this.id = config.id ?? 'anthropic';
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.costTable = config.costTable;
    this.contextLengths = config.contextLengths ?? {};
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    this.streamEnabled = config.stream ?? false;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.queue = new RequestQueue(config.concurrency ?? DEFAULT_CLOUD_CONCURRENCY);
    this.headers = {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': config.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
    };
  }

  private async fetchRaw(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...this.headers,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderTimeoutError(this.id, timeoutMs);
      }
      throw new ProviderUnreachableError(this.id, err);
    }
  }

  private async throwForStatus(response: Response): Promise<never> {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthError(this.id, response.status, response.statusText, body);
    }
    if (response.status === 429 || response.status === 529) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      throw new ProviderRateLimitError(
        this.id,
        response.status,
        response.statusText,
        body,
        retryAfterMs,
      );
    }
    throw new ProviderHttpError(this.id, response.status, response.statusText, body);
  }

  private buildBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const { system, messages } = splitSystem(request.messages);
    return {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      stream,
      ...(system !== undefined ? { system } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop?.length ? { stop_sequences: request.stop } : {}),
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.queue.run(() =>
      this.streamEnabled ? this.chatStreaming(request) : this.chatOnce(request),
    );
  }

  private async chatOnce(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.fetchRaw(
      '/v1/messages',
      { method: 'POST', body: JSON.stringify(this.buildBody(request, false)) },
      this.requestTimeoutMs,
    );
    if (!response.ok) await this.throwForStatus(response);
    const raw = (await response.json()) as AnthropicMessageResponse;

    if (!Array.isArray(raw.content)) {
      throw new ProviderResponseShapeError(
        this.id,
        'response is missing a content array',
      );
    }
    if (raw.usage.input_tokens === undefined || raw.usage.output_tokens === undefined) {
      throw new ProviderResponseShapeError(
        this.id,
        'response is missing usage — cannot meter this call (FR-G1 requires normalized usage)',
      );
    }

    const content = raw.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const modelId = raw.model ?? request.model;

    return {
      model: modelId,
      message: { role: 'assistant', content },
      finishReason: normalizeStopReason(raw.stop_reason),
      usage: normalizeUsage(
        {
          promptTokens: raw.usage.input_tokens,
          completionTokens: raw.usage.output_tokens,
        },
        modelId,
        this.costTable,
      ),
    };
  }

  private async chatStreaming(request: ChatRequest): Promise<ChatResponse> {
    let final: ChatResponse | undefined;
    for await (const event of this.streamEvents(request)) {
      if (event.type === 'final') final = event.response;
    }
    if (!final) {
      throw new ProviderResponseShapeError(this.id, 'stream ended without a final event');
    }
    return final;
  }

  /** Streams token/delta events, then a final normalized ChatResponse — same metering as chat() (FR-G1, W2-09). */
  async *chatStream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    yield* runQueuedStream(this.queue, () => this.streamEvents(request));
  }

  private async *streamEvents(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const response = await this.fetchRaw(
      '/v1/messages',
      { method: 'POST', body: JSON.stringify(this.buildBody(request, true)) },
      this.requestTimeoutMs,
    );
    if (!response.ok) await this.throwForStatus(response);
    if (!response.body) {
      throw new ProviderResponseShapeError(this.id, 'streaming response has no body');
    }

    let content = '';
    let modelId = request.model;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let stopReasonRaw: string | null = null;

    for await (const payload of readSseDataLines(response.body)) {
      const event = JSON.parse(payload) as AnthropicStreamEvent;
      switch (event.type) {
        case 'message_start':
          modelId = event.message?.model ?? modelId;
          promptTokens = event.message?.usage?.input_tokens ?? promptTokens;
          completionTokens = event.message?.usage?.output_tokens ?? completionTokens;
          break;
        case 'content_block_delta':
          if (
            event.delta?.type === 'text_delta' &&
            typeof event.delta.text === 'string'
          ) {
            content += event.delta.text;
            yield { type: 'delta', content: event.delta.text };
          }
          break;
        case 'message_delta':
          if (event.delta && event.delta.stop_reason !== undefined) {
            stopReasonRaw = event.delta.stop_reason ?? null;
          }
          if (event.usage?.output_tokens !== undefined) {
            completionTokens = event.usage.output_tokens;
          }
          break;
        case 'error':
          if (event.error) throw classifyStreamError(this.id, event.error);
          break;
        default:
          break; // ping, content_block_start/stop, message_stop — nothing to accumulate.
      }
    }

    if (promptTokens === undefined || completionTokens === undefined) {
      throw new ProviderResponseShapeError(
        this.id,
        'stream ended without usage data (no message_start event) — cannot meter this call',
      );
    }

    yield {
      type: 'final',
      response: {
        model: modelId,
        message: { role: 'assistant', content },
        finishReason: normalizeStopReason(stopReasonRaw),
        usage: normalizeUsage(
          { promptTokens, completionTokens },
          modelId,
          this.costTable,
        ),
      },
    };
  }

  private async requestModels(): Promise<AnthropicModelsResponse> {
    const response = await this.fetchRaw(
      '/v1/models',
      { method: 'GET' },
      this.healthTimeoutMs,
    );
    if (!response.ok) await this.throwForStatus(response);
    return (await response.json()) as AnthropicModelsResponse;
  }

  async listModels(): Promise<ModelInfo[]> {
    const raw = await this.requestModels();
    return raw.data.map((m) => {
      const contextLength =
        this.contextLengths[m.id] ?? (m.max_input_tokens || undefined);
      return { id: m.id, ...(contextLength !== undefined ? { contextLength } : {}) };
    });
  }

  async getContextLength(modelId: string): Promise<number | undefined> {
    if (this.contextLengths[modelId] !== undefined) return this.contextLengths[modelId];
    const raw = await this.requestModels();
    return raw.data.find((m) => m.id === modelId)?.max_input_tokens || undefined;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.requestModels();
      return {
        status: 'ok',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (
        err instanceof ProviderUnreachableError ||
        err instanceof ProviderTimeoutError
      ) {
        return {
          status: 'unreachable',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          detail: err.message,
        };
      }
      if (err instanceof ProviderHttpError) {
        return {
          status: 'error',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          detail: err.message,
        };
      }
      throw err;
    }
  }

  async warmUp(): Promise<ProviderHealth> {
    return this.health();
  }

  queueStats(): ProviderQueueStats {
    return {
      active: this.queue.activeCount,
      queued: this.queue.queuedCount,
      concurrency: this.queue.concurrency,
    };
  }
}

export function createAnthropicProvider(config: AnthropicConfig): Provider {
  return new AnthropicProvider(config);
}
