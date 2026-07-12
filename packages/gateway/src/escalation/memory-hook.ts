/**
 * R0 — memory/playbook consult hook (BLUEPRINT §3.3: "have we solved this
 * before?"). A confirmed prior lesson answers the ticket for free, before
 * any model call: the ladder exits at R0 and never touches R1-R4. This
 * package has no workspace dependency on packages/memory (out of this
 * ticket's write_scope), so the hook is an injectable interface with an
 * honest no-op default — same stub discipline as packages/loop/src/
 * anchors.ts's memory anchor, which never fabricates a finding either.
 */

export interface MemoryConsultInput {
  readonly ticketId: string;
  /** The ONE checkable success criterion this ticket is being escalated toward (mirrors the micro-loop's CRITERION step). */
  readonly criterion: string;
}

export interface MemoryConsultResult {
  /** True when a confirmed prior lesson answers the criterion outright. */
  readonly answered: boolean;
  readonly findingId?: string;
  readonly summary?: string;
}

export interface MemoryConsultHook {
  consult(input: MemoryConsultInput): MemoryConsultResult | Promise<MemoryConsultResult>;
}

/** Real wiring lands in a future ticket alongside packages/memory; until then, R0 always honestly reports "no answer" rather than fabricating one. */
export const noopMemoryConsultHook: MemoryConsultHook = {
  consult() {
    return { answered: false };
  },
};
