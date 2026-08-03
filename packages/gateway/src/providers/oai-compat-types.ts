/**
 * OpenAI-compatible adapter config + wire shapes (FR-G1, book-style split —
 * see oai-compat.ts's file header for the full split rationale). Wire shapes
 * verified against OpenAI's chat-completions reference, Ollama's
 * OpenAI-compatibility docs, and LM Studio's OpenAI-compat docs
 * (2026-07-11) — see the ticket's HANDOFF note for sources.
 */
import type { CostTable } from './usage.js';

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

export interface RawChatChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

export interface RawChatCompletionResponse {
  id?: string;
  model?: string;
  choices: RawChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface RawModel {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface RawModelsResponse {
  object?: string;
  data: RawModel[];
}

export interface OaiCompatStreamChoice {
  delta: { role?: string; content?: string | null };
  finish_reason: string | null;
}

export interface OaiCompatStreamChunk {
  model?: string;
  choices: OaiCompatStreamChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * W10-57: 60s -> 300s. This is the LOCAL path — `createLmStudioProvider` and
 * `createOllamaProvider` are both OaiCompat variants — and 60s made the
 * product's headline use case unusable.
 *
 * Measured, not estimated: driving the real product against LM Studio, the
 * creation pipeline failed with `pipeline-run: request timed out after
 * 60000ms`. It makes several SEQUENTIAL inference calls (blueprint, technical
 * slate, ticket drafts), and a local reasoning model spends nearly all of its
 * budget reasoning — 199 reasoning tokens out of 203 for a one-word reply on
 * qwen3.5-9b — so one phase alone can exceed a minute on ordinary hardware.
 *
 * A default tuned for a fast hosted API, which times out on the very model the
 * setup wizard just configured, contradicts C-1 and the README's claim that a
 * local box is "a first-class setup, not a downgrade".
 *
 * The cloud adapters (anthropic, copilot, openai) keep their own 60s: they talk
 * to hosted endpoints where a minute of silence really does mean something is
 * wrong. This value is a hung-connection guard, not a latency SLA — so it is
 * generous, but it is still bounded, and `OaiCompatConfig.requestTimeoutMs`
 * overrides it per provider.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
