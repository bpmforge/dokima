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
import type {
  ChatRole,
  ChatRequest,
  ChatResponse,
  FinishReason,
  ModelInfo,
  Provider,
  ProviderHealth,
  ProviderQueueStats,
} from './types.js';
import { normalizeUsage, LOCAL_COST_TABLE, type CostTable } from './usage.js';

export interface OaiCompatConfig {
  id: string;
  baseUrl: string;
  apiKey?: string;
  /** Requests in flight at once for this endpoint; local servers default to 1 (TECH_STACK.md). */
  concurrency?: number;
  costTable?: CostTable;
  contextLengths?: Record<string, number>;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RawChatChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

interface RawChatCompletionResponse {
  id?: string;
  model?: string;
  choices: RawChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface RawModel {
  id: string;
  object?: string;
  owned_by?: string;
}

interface RawModelsResponse {
  object?: string;
  data: RawModel[];
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;

function normalizeFinishReason(raw: string | null): FinishReason {
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
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

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

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
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

    if (!response.ok) {
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
