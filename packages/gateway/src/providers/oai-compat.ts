/**
 * OpenAI-compatible adapter (FR-G1): serves any endpoint that speaks the
 * `/v1/chat/completions` + `/v1/models` wire format — LM Studio
 * (localhost:1234/v1), Ollama (localhost:11434/v1), and generic
 * self-hosted/third-party OpenAI-compatible servers. Wire shapes verified
 * against OpenAI's chat-completions reference, Ollama's OpenAI-compatibility
 * docs, and LM Studio's OpenAI-compat docs (2026-07-11) — see the ticket's
 * HANDOFF note for sources; contract tests pin these shapes via recorded
 * fixtures, never a live call.
 *
 * Context-length introspection is intentionally static-config-only: neither
 * `/v1/models` response carries a context-length field, and each local
 * server's *native* (non-OpenAI-compat) API that does expose one uses an
 * incompatible, per-server shape (LM Studio's `/api/v0/models` has
 * `max_context_length`; Ollama's `/api/show` buries it in
 * family-prefixed `model_info` keys) — not something a single generic
 * adapter can parse without per-vendor special-casing. Callers that know
 * their model's context window pass it via `contextLengths`.
 *
 * chatStream() (W2-09/G-23) streams the same `/chat/completions` endpoint
 * with `stream: true` + `stream_options.include_usage` — identical chunk
 * shape to openai.ts's cloud path, since both speak the OpenAI-compatible
 * wire format; the SSE framing is shared via streaming.ts.
 *
 * Book-style split (file-size gate, 400-line cap): once this file exceeded
 * the cap it was split into flat sibling chapters — oai-compat-types.ts
 * (config + wire shapes + constants) and oai-compat-helpers.ts
 * (finish-reason normalization, retry-after parsing). Flat siblings (not an
 * oai-compat/ subdirectory) keep every chapter inside the ticket's original
 * `oai-compat*` write_scope, matching copilot.ts's precedent. This file is
 * the barrel: the OaiCompatProvider class and its factories are the public
 * surface.
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
  ChatRole,
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderHealth,
  ProviderQueueStats,
} from './types.js';
import type { ChatStreamEvent } from '../types.js';
import { normalizeUsage, LOCAL_COST_TABLE, type CostTable } from './usage.js';
import { normalizeFinishReason, parseRetryAfterMs } from './oai-compat-helpers.js';
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './oai-compat-types.js';
import type {
  OaiCompatConfig,
  OaiCompatStreamChunk,
  RawChatCompletionResponse,
  RawModelsResponse,
} from './oai-compat-types.js';

export type { OaiCompatConfig } from './oai-compat-types.js';

export class OaiCompatProvider implements Provider {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly costTable: CostTable;
  private readonly contextLengths: Record<string, number>;
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly queue: RequestQueue;
  private warmedAt: number | undefined;
  private warmupPromise: Promise<void> | undefined;

  constructor(config: OaiCompatConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.costTable = config.costTable ?? LOCAL_COST_TABLE;
    this.contextLengths = config.contextLengths ?? {};
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.queue = new RequestQueue(config.concurrency ?? 1);
    this.headers = {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      ...config.headers,
    };
  }

  private async fetchRaw(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await this.fetchImpl(url, {
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
    if (response.status === 429) {
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

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const response = await this.fetchRaw(path, init, timeoutMs);
    if (!response.ok) await this.throwForStatus(response);
    return (await response.json()) as T;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.ensureWarm();
    return this.queue.run(async () => {
      const body = {
        model: request.model,
        messages: request.messages,
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...(request.stop !== undefined ? { stop: request.stop } : {}),
      };

      const raw = await this.requestJson<RawChatCompletionResponse>(
        '/chat/completions',
        { method: 'POST', body: JSON.stringify(body) },
        this.requestTimeoutMs,
      );

      const choice = raw.choices?.[0];
      if (!choice) {
        throw new ProviderResponseShapeError(this.id, 'response has no choices[0]');
      }
      if (!raw.usage) {
        throw new ProviderResponseShapeError(
          this.id,
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
          this.costTable,
        ),
      };
    });
  }

  /** Streams token/delta events, then a final normalized ChatResponse — same metering as chat() (FR-G1, W2-09). */
  async *chatStream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    await this.ensureWarm();
    yield* runQueuedStream(this.queue, () => this.streamEvents(request));
  }

  private async *streamEvents(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const body = {
      model: request.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop !== undefined ? { stop: request.stop } : {}),
    };

    const response = await this.fetchRaw(
      '/chat/completions',
      { method: 'POST', body: JSON.stringify(body) },
      this.requestTimeoutMs,
    );
    if (!response.ok) await this.throwForStatus(response);
    if (!response.body) {
      throw new ProviderResponseShapeError(this.id, 'streaming response has no body');
    }

    let content = '';
    let role: ChatRole = 'assistant';
    let modelId = request.model;
    let finishReasonRaw: string | null = null;
    let usage: { promptTokens: number; completionTokens: number } | undefined;

    for await (const payload of readSseDataLines(response.body)) {
      if (payload === '[DONE]') continue;
      const event = JSON.parse(payload) as OaiCompatStreamChunk;
      modelId = event.model ?? modelId;
      const choice = event.choices[0];
      if (choice) {
        if (choice.delta.role) role = choice.delta.role as ChatRole;
        if (choice.delta.content) {
          content += choice.delta.content;
          yield { type: 'delta', content: choice.delta.content };
        }
        if (choice.finish_reason) finishReasonRaw = choice.finish_reason;
      }
      if (event.usage) {
        usage = {
          promptTokens: event.usage.prompt_tokens,
          completionTokens: event.usage.completion_tokens,
        };
      }
    }

    if (!usage) {
      throw new ProviderResponseShapeError(
        this.id,
        'stream ended without a usage-bearing chunk (stream_options.include_usage) — cannot meter this call',
      );
    }

    yield {
      type: 'final',
      response: {
        model: modelId,
        message: { role, content },
        finishReason: normalizeFinishReason(finishReasonRaw),
        usage: normalizeUsage(usage, modelId, this.costTable),
      },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const raw = await this.requestJson<RawModelsResponse>(
      '/models',
      { method: 'GET' },
      this.healthTimeoutMs,
    );
    return raw.data.map((m) => ({
      id: m.id,
      ...(this.contextLengths[m.id] !== undefined
        ? { contextLength: this.contextLengths[m.id] }
        : {}),
    }));
  }

  async getContextLength(modelId: string): Promise<number | undefined> {
    return this.contextLengths[modelId];
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.requestJson<RawModelsResponse>(
        '/models',
        { method: 'GET' },
        this.healthTimeoutMs,
      );
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
    const result = await this.health();
    if (result.status === 'ok') this.warmedAt = Date.now();
    return result;
  }

  private async ensureWarm(): Promise<void> {
    if (this.warmedAt !== undefined) return;
    if (!this.warmupPromise) {
      this.warmupPromise = this.warmUp()
        .catch(() => undefined)
        .then(() => {
          this.warmupPromise = undefined;
        });
    }
    await this.warmupPromise;
  }

  queueStats(): ProviderQueueStats {
    return {
      active: this.queue.activeCount,
      queued: this.queue.queuedCount,
      concurrency: this.queue.concurrency,
    };
  }
}

export function createOaiCompatProvider(config: OaiCompatConfig): Provider {
  return new OaiCompatProvider(config);
}

const LM_STUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/** LM Studio local server — defaults to its documented default port (docs/TECH_STACK.md). */
export function createLmStudioProvider(config: Partial<OaiCompatConfig> = {}): Provider {
  return new OaiCompatProvider({
    id: 'lm-studio',
    baseUrl: LM_STUDIO_DEFAULT_BASE_URL,
    concurrency: 1,
    ...config,
  });
}

/** Ollama's OpenAI-compatibility layer — defaults to its documented default port. */
export function createOllamaProvider(config: Partial<OaiCompatConfig> = {}): Provider {
  return new OaiCompatProvider({
    id: 'ollama',
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    concurrency: 1,
    ...config,
  });
}
