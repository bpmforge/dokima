/**
 * Typed HANDOFF contract + universal block renderer (BLUEPRINT §4). The
 * HANDOFF block is the bounded agent contract, rendered identically whether
 * dispatched to a child-process session, an API call, or pasted for a human
 * (docs/research/source-system-experts.md HANDOFF protocol). `packages/loop`
 * may not import `@shipwright/tickets` (ARCHITECTURE.md §4 dependency
 * matrix) — `HandoffTicket` is a local, minimal projection of the two
 * ticket fields a HANDOFF needs, not the full ticket contract.
 */

export interface HandoffTicket {
  readonly id: string;
  readonly title: string;
}

export interface Handoff {
  /** The specialist role, e.g. "coding-agent", "reviewer". */
  readonly role: string;
  /** One-line mission, rendered after the role on the ROLE line. */
  readonly mission: string;
  readonly ticket: HandoffTicket;
  /** Token-budgeted context packet (already assembled — packing is FR-L5's own concern). */
  readonly context: string;
  /** Exclusive globs; edits outside refuse to apply. */
  readonly writeScope: readonly string[];
  /** Acceptance criteria / exact deliverable paths. */
  readonly produce: readonly string[];
  /** The command/validator that must exit 0. */
  readonly verify: string;
}

const BLOCK_RULE = '═'.repeat(40);
const RETURN_LINE =
  'RETURN: Completion Manifest (files produced, verify result, evidence)';

/** Renders a `Handoff` to the universal `════`-delimited block format (BLUEPRINT §4). */
export function renderHandoff(handoff: Handoff): string {
  const lines = [
    BLOCK_RULE,
    `ROLE: ${handoff.role} — ${handoff.mission}`,
    `TICKET: ${handoff.ticket.id} ${handoff.ticket.title}`,
    `CONTEXT: ${handoff.context}`,
    `WRITE-SCOPE: ${handoff.writeScope.join(', ')}`,
    `PRODUCE: ${handoff.produce.join('; ')}`,
    `VERIFY: ${handoff.verify}`,
    RETURN_LINE,
    BLOCK_RULE,
  ];
  return lines.join('\n');
}
