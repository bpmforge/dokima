/**
 * Anthropic Messages API config + wire shapes (W2-02, W2-09/G-23 book-style
 * split — see anthropic.ts's file header for the full split rationale).
 * Wire shapes verified 2026-07-11 via WebFetch against
 * platform.claude.com/docs/en/api/messages, .../build-with-claude/streaming,
 * and .../api/models-list — not training data.
 */
import type { CostTable } from './usage.js';

export interface AnthropicConfig {
  id?: string;
  /** Pre-resolved secret (FR-S2) — resolve the credential ref before constructing this adapter. */
  apiKey: string;
  baseUrl?: string;
  anthropicVersion?: string;
  /** Real per-model pricing; required (see anthropic.ts header — no $0 default for a paid API). */
  costTable: CostTable;
  /** Static override; falls back to a live /v1/models lookup, which does carry max_input_tokens. */
  contextLengths?: Record<string, number>;
  concurrency?: number;
  /** Anthropic requires max_tokens on every request; used when a call doesn't specify one. */
  defaultMaxTokens?: number;
  /** Use the streaming (SSE) wire path internally — see anthropic.ts header. */
  stream?: boolean;
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_TOKENS = 4096;
/** Cloud APIs support real parallelism, unlike a single-model local server (RequestQueue's default of 1); kept conservative and fully configurable since neither vendor publishes a universal safe number. */
export const DEFAULT_CLOUD_CONCURRENCY = 4;

export interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface AnthropicMessageResponse {
  id?: string;
  model?: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicModel {
  id: string;
  max_input_tokens?: number;
}

export interface AnthropicModelsResponse {
  data: AnthropicModel[];
}

export interface AnthropicStreamEvent {
  type: string;
  message?: { model?: string; usage?: AnthropicUsage };
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string | null;
  };
  usage?: AnthropicUsage;
  error?: { type: string; message: string };
}
