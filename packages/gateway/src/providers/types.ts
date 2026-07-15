/**
 * Provider framework contracts (FR-G1, BLUEPRINT §3.3): every model provider
 * — cloud or local — implements this same interface, so the escalation
 * ladder, budget breakers, and role matrix (later gateway tickets) never
 * special-case a specific vendor.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/** Normalized regardless of provider: tokens in/out and cost via the price table (local = $0). */
export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export type FinishReason =
  'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown';

export interface ChatResponse {
  model: string;
  message: ChatMessage;
  finishReason: FinishReason;
  usage: NormalizedUsage;
}

export interface ModelInfo {
  id: string;
  /** Only populated when the provider's discovery response carries it (rare) or a static override is configured. */
  contextLength?: number;
}

export type ProviderHealthStatus = 'ok' | 'unreachable' | 'error';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  latencyMs?: number;
  checkedAt: string;
  detail?: string;
}

/** Per-endpoint queue/warm-up state a caller can inspect without triggering a call. */
export interface ProviderQueueStats {
  active: number;
  queued: number;
  concurrency: number;
}

export interface Provider {
  readonly id: string;

  chat(request: ChatRequest): Promise<ChatResponse>;

  /** Model discovery. */
  listModels(): Promise<ModelInfo[]>;

  /** Context-length introspection for one model; undefined when unknown. */
  getContextLength(modelId: string): Promise<number | undefined>;

  /** Cheap reachability check — does not load a model or spend tokens. */
  health(): Promise<ProviderHealth>;

  /** Warm-up ping (FR-G1): primes a cold local endpoint before the first real call. */
  warmUp(): Promise<ProviderHealth>;

  queueStats(): ProviderQueueStats;
}
