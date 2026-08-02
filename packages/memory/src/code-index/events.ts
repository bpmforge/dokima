/**
 * Code-index audit events (FR-M4: "agent code_search calls are audited
 * events"). Same injectable-sink constraint as `consolidation/events.ts`/
 * `gateway/budget/events.ts`: this package can't depend on
 * `@dokima/events` (no `package.json` dependency declared within this
 * ticket's write_scope), so events are minted here and handed to a
 * caller-supplied sink wired to the real event log elsewhere.
 *
 * `code_index.code_search` fires once per `tool.ts`'s `codeSearchTool` call
 * — the agent-facing surface. Plain `search.ts#codeSearch` calls (e.g. the
 * future Context Packer, FR-L5, ranking file slices) are not agent tool
 * invocations and don't emit this event, matching how `packages/mcp`
 * audits tool *calls*, not every internal read. `code_index.indexed` fires
 * once per `indexer.ts#indexProject` run, recording what got (re)indexed.
 */

export type CodeIndexEventType = 'code_index.code_search' | 'code_index.indexed';

export interface CodeIndexEvent {
  readonly type: CodeIndexEventType;
  readonly occurredAt: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface CodeIndexEventSink {
  emit(event: CodeIndexEvent): void | Promise<void>;
}

export const noopCodeIndexEventSink: CodeIndexEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt
    // out explicitly by omitting a sink; production call sites pass a real
    // one wired to packages/events.
  },
};

export function createInMemoryCodeIndexEventSink(): CodeIndexEventSink & {
  events: CodeIndexEvent[];
} {
  const events: CodeIndexEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
