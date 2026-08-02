/**
 * Consolidation audit events (DATABASE.md §5: "Consolidation (sleep-time
 * job) rewrites facts/playbook via ordinary events (`memory.consolidated`)
 * so even memory mutations are audited"). Same injectable-sink constraint
 * documented throughout this package (`playbook/events.ts`): this package
 * can't depend on `@dokima/events` (no `package.json` dependency
 * declared within this ticket's write_scope), so events are minted here and
 * handed to a caller-supplied sink wired to the real event log elsewhere.
 * `memory.error_first_recall` is a distinct type from `playbook.r0_hit` —
 * that one records the R0 escalation-rung short-circuit; this one records
 * the packet-assembly ordering guarantee US-602 AC-2 requires ("recall
 * events are visible in the session provenance").
 */

export type ConsolidationEventType = 'memory.consolidated' | 'memory.error_first_recall';

export interface ConsolidationEvent {
  readonly type: ConsolidationEventType;
  readonly occurredAt: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface ConsolidationSink {
  emit(event: ConsolidationEvent): void | Promise<void>;
}

export const noopConsolidationSink: ConsolidationSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt
    // out explicitly by omitting a sink; production call sites pass a real
    // one wired to packages/events.
  },
};

export function createInMemoryConsolidationSink(): ConsolidationSink & {
  events: ConsolidationEvent[];
} {
  const events: ConsolidationEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
