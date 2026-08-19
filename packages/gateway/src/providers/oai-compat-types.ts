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
  /** Max quiet between stream chunks before the stream is treated as hung (W13-15). */
  streamIdleMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Extra fields merged into every chat request body (W13-10).
   *
   * OpenAI-compatible endpoints are a family, not a standard, and the
   * differences land exactly where local models live. Found in live testing:
   * `prism-ml/bonsai-27b` is a reasoning model that spends ~200 tokens
   * thinking before answering, and the only thing that stops it is
   * `reasoning_effort` — measured, with `chat_template_kwargs.enable_thinking`
   * and a `/no_think` suffix both doing nothing. Without this the product
   * cannot configure such a model at all, which cuts against D-024 option (a):
   * local-only is a guaranteed-supported configuration.
   *
   * MERGED FIRST, so the derived fields always win. A config value that could
   * overwrite `model` would let a provider entry silently defeat the model
   * matrix — and with it the maker != verifier separation routing enforces.
   */
  requestExtras?: Record<string, unknown>;
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
/**
 * 300s, five times the 60s every hosted kind uses — deliberate, not drift.
 *
 * This is the LOCAL adapter, and a 27B model on a laptop genuinely takes
 * minutes for one call: measured at over 300s in live testing, which is what
 * W13-13 was filed for. A hosted endpoint that has not answered in 60s is not
 * slow, it is broken. See docs/design/RUN_LIMITS.md for every limit that can
 * stop a run and why each is the value it is.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/**
 * How long a STREAM may go quiet before it is treated as hung (W13-15).
 *
 * The bound that matters for a generation is time since the last token, not
 * total duration: a model producing steadily for six minutes is working, and a
 * model silent for sixty seconds is not, whatever its elapsed total. 60s is
 * generous for a token gap even on loaded local hardware, and short enough
 * that a genuinely hung endpoint is noticed while someone is still watching.
 */
export const DEFAULT_STREAM_IDLE_MS = 60_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
