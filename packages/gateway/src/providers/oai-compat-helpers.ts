/**
 * OpenAI-compatible wire-shape helpers (book-style split — see
 * oai-compat.ts's file header): finish-reason normalization, tool-call
 * normalization (FR-G9), and retry-after parsing.
 */
import { ProviderResponseShapeError } from './errors.js';
import type { RawToolCall, RawToolCallDelta } from './oai-compat-types.js';
import type { FinishReason, ToolCall, ToolSchema } from './types.js';

type ToolCallAccumulator = Map<number, { id: string; name: string; args: string }>;

/** Folds one streamed tool_calls delta into its by-index accumulator (id/name land on the first delta for an index, arguments arrive fragmented). */
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

/** `ToolSchema` -> the OpenAI wire tool shape; JSON.stringify drops `description` when undefined. */
export function toRawTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export function normalizeFinishReason(raw: string | null): FinishReason {
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

/** Retry-After per RFC 9110 §10.2.3: either delay-seconds or an HTTP-date. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}
