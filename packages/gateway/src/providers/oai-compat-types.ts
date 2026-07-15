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

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
