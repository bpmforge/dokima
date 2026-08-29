/**
 * Provider framework contracts (FR-G1, BLUEPRINT §3.3): every model provider
 * — cloud or local — implements this same interface, so the escalation
 * ladder, budget breakers, and role matrix (later gateway tickets) never
 * special-case a specific vendor.
 */
import { ProviderResponseShapeError } from './errors.js';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on an assistant turn that requested tool calls (FR-G9, W11-12): echoes the model's own `tool_calls` back into history, since a following `tool`-role turn's `toolCallId` only makes sense next to the assistant turn it answers. */
  toolCalls?: ToolCall[];
  /** Present on a `tool`-role turn (FR-G9, W11-12): the id of the `ToolCall` — from a preceding assistant turn's `toolCalls` — this message's `content` is the result of. */
  toolCallId?: string;
}

/** A callable tool the model may invoke, described as JSON Schema (FR-G9, D-023) — the same shape every provider's wire format is normalized to/from. */
export interface ToolSchema {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

/** `ToolSchema` -> the OpenAI wire tool shape; JSON.stringify drops `description` when undefined. */
export function toRawTool(tool: ToolSchema): Record<string, unknown> {
  const { name, description, parameters } = tool;
  return { type: 'function', function: { name, description, parameters } };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: ToolSchema[];
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

/** One tool invocation the model requested, normalized regardless of provider wire shape (arguments always a parsed object, never a raw JSON string a caller must re-decode per-provider). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  model: string;
  message: ChatMessage;
  finishReason: FinishReason;
  usage: NormalizedUsage;
  /** Present only when the model actually returned tool calls — absent, not empty, otherwise. */
  toolCalls?: ToolCall[];
}

/**
 * FR-G9 OpenAI tool-calling wire shapes, and their (de)serialize helpers
 * (`toRawTool` above; `applyToolCallDelta`, `finalizeToolCallDeltas`,
 * `normalizeToolCalls`, `toRawToolCalls`, and `toRawMessage` below, in the
 * section this comment introduces):
 * shared by any OpenAI-compatible adapter, including oai-compat.ts, which
 * imports this pair from here rather than keeping its own copies (W11-07
 * finished the consolidation W11-06 could not: oai-compat.ts was outside
 * W11-06's write_scope). Precisely what "shared" means differs by call
 * (W11-06, correcting an earlier version of this comment that claimed
 * openai.ts's cloud path delegates to oai-compat.ts across the board — true
 * only for non-streaming Provider methods, via the `OaiCompatProvider`
 * instance openai.ts holds as `this.inner`): openai.ts's own SSE loop
 * (`streamEvents()`, backing both `chat()`'s internal `stream` toggle and
 * the public `chatStream()`) imports these wire-shape functions directly
 * rather than delegating to `this.inner.chatStream()`, because that method
 * awaits a warm-up ping and queues on a second, independent RequestQueue
 * before its SSE loop starts — acceptable for oai-compat.ts's local-server
 * callers, but a concurrency-contract and extra-round-trip change
 * openai.ts's cloud callers did not ask for. Declared here rather than in
 * oai-compat.ts because W11-01's write_scope covered only this file and
 * oai-compat.ts, not the oai-compat-types.ts/oai-compat-helpers.ts chapter
 * siblings, and oai-compat.ts has no room left under the 400-line file-size
 * cap. `arguments` arrives as a JSON-encoded string, not yet parsed.
 *
 * W11-12 makes the round trip expressible: `ChatRole` gains `'tool'` and
 * `ChatMessage` gains `toolCalls`/`toolCallId` (above) so a caller can build
 * an assistant tool-call turn and its answering tool-result turn; both
 * adapters map `request.messages` through `toRawMessage` (below) instead of
 * handing `ChatMessage[]` straight to `JSON.stringify`. OUT OF SCOPE: this
 * only makes the wire shape expressible and adapter-tested against recorded
 * fixtures — whether `packages/harbormaster`'s agent-session loop actually
 * emits these fields against a real provider is a separate claim with its
 * own evidence needed (as of W11-12 that loop still echoes tool results as
 * a synthetic `user` message per its own header comment, not a `tool` turn).
 */
export interface RawToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** Streaming variant: id/name typically land on the first delta for an index, arguments arrive fragmented across deltas. */
export interface RawToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export type ToolCallAccumulator = Map<number, { id: string; name: string; args: string }>;

/** Folds one streamed tool_calls delta into its by-index accumulator. */
export function applyToolCallDelta(
  acc: ToolCallAccumulator,
  delta: RawToolCallDelta,
): void {
  const entry = acc.get(delta.index) ?? { id: '', name: '', args: '' };
  if (delta.id) entry.id = delta.id;
  if (delta.function?.name) entry.name = delta.function.name;
  if (delta.function?.arguments) entry.args += delta.function.arguments;
  acc.set(delta.index, entry);
}

/** Once a stream ends, turns the by-index accumulator into wire-shaped `RawToolCall[]`, ordered by index. */
export function finalizeToolCallDeltas(acc: ToolCallAccumulator): RawToolCall[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, { id, name, args }]) => ({
      id,
      type: 'function',
      function: { name, arguments: args },
    }));
}

/** Raw wire tool_calls -> normalized `ToolCall[]`, arguments parsed once so callers never re-decode a per-provider JSON string. */
export function normalizeToolCalls(providerId: string, raw: RawToolCall[]): ToolCall[] {
  return raw.map(({ id, function: fn }) => {
    try {
      return {
        id,
        name: fn.name,
        arguments: JSON.parse(fn.arguments) as Record<string, unknown>,
      };
    } catch {
      throw new ProviderResponseShapeError(
        providerId,
        `tool call "${fn.name}" has unparseable arguments JSON: ${fn.arguments}`,
      );
    }
  });
}

/** Normalized `ToolCall[]` -> the OpenAI wire `tool_calls` shape (inverse of `normalizeToolCalls`): `arguments` re-encoded to a JSON string, matching what an assistant turn's `tool_calls` field carries on the wire. */
export function toRawToolCalls(calls: ToolCall[]): RawToolCall[] {
  return calls.map(({ id, name, arguments: args }) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }));
}

/** `ChatMessage` -> the wire message object an OpenAI-compatible request body expects: an assistant tool-call turn's `toolCalls` becomes `tool_calls`, a tool-result turn's `toolCallId` becomes `tool_call_id` — both snake_case on the wire, present only when the turn actually carries them. */
export function toRawMessage(message: ChatMessage): Record<string, unknown> {
  const { role, content, toolCalls, toolCallId } = message;
  return {
    role,
    content,
    ...(toolCalls !== undefined ? { tool_calls: toRawToolCalls(toolCalls) } : {}),
    ...(toolCallId !== undefined ? { tool_call_id: toolCallId } : {}),
  };
}

export interface ModelInfo {
  id: string;
  /** Only populated when the provider's discovery response carries it (rare) or a static override is configured. */
  contextLength?: number;
  /**
   * What the PROVIDER said this model is for (W21-93). Absent when it said
   * nothing, and absence must never be read as "generative" — an endpoint that
   * does not report kinds is unknown, not confirmed.
   *
   * Exists because the model picker was offering embedding models as "the
   * model that writes the code": measured 2026-08-28, LM Studio served four of
   * them among 34 and the picker listed all 34. An embedding model cannot
   * generate text, so choosing one produces a setup broken by construction and
   * a failure that surfaces much later.
   *
   * Derived from the provider response ONLY. The four here happen to share a
   * `text-embedding-` prefix, which makes a name match look tempting — but
   * that prefix is LM Studio's normalization, and an Ollama user sees
   * `nomic-embed-text:latest` with none. A name rule would protect one
   * provider and silently fail another.
   */
  kind?: 'generative' | 'embedding';
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
