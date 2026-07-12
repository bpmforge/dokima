/**
 * Google Vertex AI adapter (FR-G1, W2-04, D-007): Gemini models over
 * Vertex's regional REST endpoint
 * (`https://{location}-aiplatform.googleapis.com/v1/projects/{project}/
 * locations/{location}/publishers/google/models/{model}:generateContent`),
 * authenticated via the ADC chain in vertex-auth.ts rather than an API key
 * (TECH_STACK.md "Vertex auth = ADC, not API keys (D-007)"). `project` and
 * `location` (region) are required config — Vertex model endpoints are
 * regional, per TECH_STACK.md. Wire shapes verified 2026-07-12 (see
 * vertex-chat.ts's file header); contract tests pin them via recorded
 * fixtures (vertex-fixtures.ts), never a live call (docs/TESTING.md).
 *
 * Cost table is required, not defaulted — same reasoning as anthropic.ts/
 * openai.ts: an unpriced paid cloud call would silently under-report spend.
 *
 * Model discovery (`listModels`/`getContextLength`) is intentionally
 * static-config-only, the same scope decision oai-compat.ts made for
 * context-length: Vertex's publisher-model-catalog REST shape could not be
 * confirmed to the same verify-before-coding bar as the chat/auth wire
 * formats above (no live call, no independently-cross-referenced source),
 * so this adapter never fabricates a discovery response — callers that know
 * their model roster pass it via `models`/`contextLengths`. A future
 * ticket that can verify (or add) a real discovery endpoint should replace
 * this.
 *
 * `health()`/`warmUp()` always verify ADC token acquisition (the actual
 * "not configured" signal TECH_STACK.md calls out); they additionally probe
 * the Vertex endpoint itself via the free `countTokens` call (vertex-
 * chat.ts) when the caller supplies `healthCheckModel` — never a hardcoded
 * model id, since guessing one would be exactly the kind of hallucinated
 * external-API detail `MASTER_PROMPT.md` and `PLAYBOOK.md` forbid. Per the
 * Provider contract (types.ts), health/warmUp never load a model or spend
 * generation tokens — `countTokens` is a free, non-generating call, unlike
 * `generateContent`.
 *
 * Auth is `google-auth-library`'s `GoogleAuth`/ADC chain (vertex-auth.ts),
 * per TECH_STACK.md L121-125 (never hand-rolled). The dependency lives in the
 * root `package.json` rather than `packages/gateway/package.json` because this
 * ticket's write_scope excludes the latter and the conductor gate only blesses
 * the root one — see vertex-auth.ts's SCOPE / DEPENDENCY NOTE. New providers
 * are not re-exported from providers/index.ts (also outside this ticket's
 * write_scope) — same gap W2-01/02 left; a future ticket wiring a gateway
 * registry should add that export.
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
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderHealth,
  ProviderQueueStats,
} from './types.js';
import type { CostTable } from './usage.js';
import {
  ensureVertexAccessToken,
  type VertexAuthClientFactory,
  type VertexAuthRuntime,
} from './vertex-auth.js';
import {
  buildCountTokensBody,
  buildGenerateContentBody,
  parseCountTokensResponse,
  parseGenerateContentResponse,
} from './vertex-chat.js';

export interface VertexConfig {
  id?: string;
  /** GCP project id (TECH_STACK.md — Vertex requires project + region). */
  project: string;
  /** Region, e.g. "us-central1" — Vertex model endpoints are regional. */
  location: string;
  /** Pre-resolved service-account key JSON (FR-S2 credential ref) — "service-account JSON ref" per acceptance. Takes precedence over ADC file discovery. */
  serviceAccountJson?: string;
  /** Overrides GOOGLE_APPLICATION_CREDENTIALS discovery; mainly for tests. */
  credentialsFilePath?: string;
  /** Real per-model pricing; required (see file header — no $0 default for a paid API). */
  costTable: CostTable;
  contextLengths?: Record<string, number>;
  /** Static model catalog (see file header re: no verified discovery endpoint). */
  models?: ModelInfo[];
  /** Model id used for the free countTokens reachability probe in health()/warmUp(); omit to skip it (auth-only health check). */
  healthCheckModel?: string;
  concurrency?: number;
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Override `GoogleAuth` construction so contract tests acquire tokens without the network (docs/TESTING.md). */
  authClientFactory?: VertexAuthClientFactory;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
/** Cloud APIs support real parallelism, unlike a single-model local server (RequestQueue's default of 1); kept conservative and fully configurable since Google does not publish a universal safe number. */
const DEFAULT_CLOUD_CONCURRENCY = 4;

/** Retry-After per RFC 9110 §10.2.3 (same logic as anthropic.ts/openai.ts; not exported there, so duplicated — see file header re: write_scope). */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

export class VertexProvider implements Provider {
  readonly id: string;
  private readonly project: string;
  private readonly location: string;
  private readonly costTable: CostTable;
  private readonly contextLengths: Record<string, number>;
  private readonly models: ModelInfo[];
  private readonly healthCheckModel: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly queue: RequestQueue;
  private readonly authRuntime: VertexAuthRuntime;

  constructor(config: VertexConfig) {
    if (!config.project) throw new RangeError('VertexConfig.project is required');
    if (!config.location) throw new RangeError('VertexConfig.location is required');
    this.id = config.id ?? 'vertex';
    this.project = config.project;
    this.location = config.location;
    this.costTable = config.costTable;
    this.contextLengths = config.contextLengths ?? {};
    this.models = config.models ?? [];
    this.healthCheckModel = config.healthCheckModel;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.queue = new RequestQueue(config.concurrency ?? DEFAULT_CLOUD_CONCURRENCY);
    this.authRuntime = {
      id: this.id,
      serviceAccountJson: config.serviceAccountJson,
      credentialsFilePath: config.credentialsFilePath,
      authClientFactory: config.authClientFactory,
    };
  }

  private baseUrl(): string {
    return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google`;
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const accessToken = await ensureVertexAccessToken(this.authRuntime);
    try {
      return await this.fetchImpl(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
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

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.queue.run(() => this.chatOnce(request));
  }

  private async chatOnce(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.post(
      `/models/${request.model}:generateContent`,
      buildGenerateContentBody(request),
      this.requestTimeoutMs,
    );
    if (!response.ok) await this.throwForStatus(response);
    const raw = await response.json();
    return parseGenerateContentResponse(this.id, request.model, raw, this.costTable);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async getContextLength(modelId: string): Promise<number | undefined> {
    return this.contextLengths[modelId];
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await ensureVertexAccessToken(this.authRuntime);
      if (this.healthCheckModel) {
        const response = await this.post(
          `/models/${this.healthCheckModel}:countTokens`,
          buildCountTokensBody(),
          this.healthTimeoutMs,
        );
        if (!response.ok) await this.throwForStatus(response);
        parseCountTokensResponse(this.id, await response.json());
      }
      return {
        status: 'ok',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        ...(this.healthCheckModel
          ? {}
          : {
              detail:
                'ADC token acquired; set healthCheckModel to also verify the Vertex endpoint',
            }),
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
      if (err instanceof ProviderHttpError || err instanceof ProviderResponseShapeError) {
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

export function createVertexProvider(config: VertexConfig): Provider {
  return new VertexProvider(config);
}
