/**
 * OpenAI cloud adapter (FR-G1, W2-02): real api.openai.com speaks the same
 * `/v1/chat/completions` + `/v1/models` wire format oai-compat.ts already
 * implements for LM Studio/Ollama/generic endpoints (verified 2026-07-11
 * against OpenAI's chat-completions reference), so this composes
 * OaiCompatProvider for every non-streaming Provider method rather than
 * re-parsing the same JSON shape a second time. What a real cloud account
 * needs on top: a required Authorization bearer, optional org/project
 * headers, a required cost table (real spend, never $0), and — the actual
 * new capability versus W2-01 — an internal SSE streaming path (chunk
 * format verified 2026-07-11 against
 * developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events),
 * aggregated into the same normalized ChatResponse. Contract tests pin both
 * wire paths via recorded fixtures (fixtures.ts + openai-fixtures.ts), never
 * a live call (docs/TESTING.md).
 *
 * API key handling (FR-S2): `apiKey` must already be resolved from a
 * credential ref by the caller — see anthropic.ts's file header for the
 * same constraint (packages/gateway/package.json is outside this ticket's
 * write_scope, so no dependency on packages/shared's credential store can
 * be added here).
 *
 * Streaming has two entry points sharing one SSE parse (`streamEvents`,
 * W2-09/G-23): the `stream` config toggle chat() has always had (unchanged
 * behavior), and the new public `chatStream()`, which yields delta events
 * as they arrive and a final event carrying the identical normalized
 * ChatResponse — same metering, no unmetered streamed call.
 */
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseShapeError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';
import { createOaiCompatProvider } from './oai-compat.js';
import { RequestQueue } from './request-queue.js';
import { readSseDataLines, runQueuedStream } from './streaming.js';
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
import type { ChatStreamEvent } from '../types.js';
import { normalizeUsage, type CostTable } from './usage.js';

export interface OpenAiConfig {
  id?: string;
  /** Pre-resolved secret (FR-S2) — resolve the credential ref before constructing this adapter. */
  apiKey: string;
  baseUrl?: string;
  /** Sent as OpenAI-Organization; only needed for legacy user API keys tied to multiple orgs. */
  organization?: string;
  /** Sent as OpenAI-Project; only needed for legacy user API keys tied to multiple projects. */
  project?: string;
  /** Real per-model pricing; required (see file header — no $0 default for a paid API). */
  costTable: CostTable;
  contextLengths?: Record<string, number>;
  concurrency?: number;
  /** Use the streaming (SSE) wire path internally — see file header. */
  stream?: boolean;
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Cloud APIs support real parallelism, unlike a single-model local server (RequestQueue's default of 1); kept conservative and fully configurable since neither vendor publishes a universal safe number. */
const DEFAULT_CLOUD_CONCURRENCY = 4;

interface OpenAiStreamChoice {
  delta: { role?: string; content?: string | null };
  finish_reason: string | null;
}

interface OpenAiStreamChunk {
  model?: string;
  choices: OpenAiStreamChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

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

/** Retry-After per RFC 9110 §10.2.3 (same logic as oai-compat.ts; not exported there, so duplicated — see file header re: write_scope). */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

export class OpenAiProvider implements Provider {
  readonly id: string;
  private readonly inner: Provider;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly costTable: CostTable;
  private readonly streamEnabled: boolean;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly streamQueue: RequestQueue;

  constructor(config: OpenAiConfig) {
    this.id = config.id ?? 'openai';
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.costTable = config.costTable;
    this.streamEnabled = config.stream ?? false;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.streamQueue = new RequestQueue(config.concurrency ?? DEFAULT_CLOUD_CONCURRENCY);
    this.headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      ...(config.organization ? { 'OpenAI-Organization': config.organization } : {}),
      ...(config.project ? { 'OpenAI-Project': config.project } : {}),
    };
    this.inner = createOaiCompatProvider({
      id: this.id,
      baseUrl: this.baseUrl,
      headers: this.headers,
      concurrency: config.concurrency ?? DEFAULT_CLOUD_CONCURRENCY,
      costTable: this.costTable,
      contextLengths: config.contextLengths,
      requestTimeoutMs: this.requestTimeoutMs,
      healthTimeoutMs: config.healthTimeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.streamEnabled) return this.inner.chat(request);
    return this.streamQueue.run(() => this.chatStreaming(request));
  }

  private async fetchRaw(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...this.headers,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderTimeoutError(this.id, this.requestTimeoutMs);
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
    yield* runQueuedStream(this.streamQueue, () => this.streamEvents(request));
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

    const response = await this.fetchRaw('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
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
      const event = JSON.parse(payload) as OpenAiStreamChunk;
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

  listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }

  getContextLength(modelId: string): Promise<number | undefined> {
    return this.inner.getContextLength(modelId);
  }

  health(): Promise<ProviderHealth> {
    return this.inner.health();
  }

  warmUp(): Promise<ProviderHealth> {
    return this.inner.warmUp();
  }

  /**
   * Two independent RequestQueues back this adapter — `inner`'s (non-streaming
   * chat()) and `streamQueue` (chat() with the `stream` toggle, and
   * chatStream(), W2-09) — since either can be active at once now that
   * chatStream() no longer requires `stream: true`, report combined load
   * rather than picking one queue by config.
   */
  queueStats(): ProviderQueueStats {
    const inner = this.inner.queueStats();
    return {
      active: inner.active + this.streamQueue.activeCount,
      queued: inner.queued + this.streamQueue.queuedCount,
      concurrency: this.streamQueue.concurrency,
    };
  }
}

export function createOpenAiProvider(config: OpenAiConfig): Provider {
  return new OpenAiProvider(config);
}
