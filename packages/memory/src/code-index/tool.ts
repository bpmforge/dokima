/**
 * The agent-facing `code_search` tool (FR-M4: "agent code_search calls are
 * audited events"). Thin wrapper over `search.ts#codeSearch` that always
 * mints a `code_index.code_search` event through the caller-supplied sink —
 * unlike a bare `codeSearch` call (e.g. the future Context Packer's
 * internal ranking reads), every invocation through this entry point is an
 * agent tool call and gets audited, mirroring `packages/mcp`'s
 * `requestToolCall` auditing exactly one event per call.
 */
import { noopCodeIndexEventSink } from './events.js';
import type { CodeIndexEventSink } from './events.js';
import { codeSearch } from './search.js';
import type { CodeSearchOptions, CodeSearchResult } from './search.js';
import type { SqliteHandle } from '../store/handle.js';

export interface CodeSearchToolInput {
  readonly actorId: string;
  readonly query: string;
  readonly topK?: number;
  readonly pathFilter?: string | null;
}

export interface CodeSearchToolOptions extends Pick<
  CodeSearchOptions,
  'embeddingProvider'
> {
  readonly sink?: CodeIndexEventSink;
  readonly now?: () => string;
}

export async function codeSearchTool(
  handle: SqliteHandle,
  input: CodeSearchToolInput,
  options: CodeSearchToolOptions = {},
): Promise<CodeSearchResult[]> {
  const sink = options.sink ?? noopCodeIndexEventSink;
  const now = options.now ?? (() => new Date().toISOString());

  const results = await codeSearch(handle, input.query, {
    topK: input.topK,
    pathFilter: input.pathFilter,
    embeddingProvider: options.embeddingProvider,
  });

  await sink.emit({
    type: 'code_index.code_search',
    occurredAt: now(),
    detail: {
      actorId: input.actorId,
      query: input.query,
      topK: input.topK ?? null,
      pathFilter: input.pathFilter ?? null,
      resultCount: results.length,
    },
  });

  return results;
}
