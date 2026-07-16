import { deriveLanes } from './lanes.js';
import { lintDecomposition } from './linter.js';
import { renderMermaid } from './mermaid.js';
import type { DecomposedPlan, DecomposedTicket, TicketDraftInput } from './types.js';

/**
 * BLUEPRINT §4 step 4 / US-203: turn a design's raw ticket drafts into a
 * typed DAG — lanes derived from write-scope disjointness (never guessed),
 * per-ticket acceptance criteria and executable verify carried through
 * unchanged, plan-linter violations (AC2) surfaced rather than thrown away,
 * and a Mermaid rendering for the artifact viewer. The return value is
 * plain JSON-serializable data — a human (or the UI) can edit the tickets
 * and call `decompose()` again before the build loop starts; nothing here
 * mutates in place or hides state in a class.
 */
export function decompose(drafts: readonly TicketDraftInput[]): DecomposedPlan {
  const lanes = deriveLanes(drafts);

  const tickets: DecomposedTicket[] = drafts.map((draft) => ({
    id: draft.id,
    type: draft.type,
    title: draft.title,
    lane: lanes.get(draft.id) ?? draft.id,
    writeScope: draft.writeScope,
    dependsOn: draft.dependsOn,
    acceptance: draft.acceptance.map((text, index) => ({
      id: `${draft.id}-AC${index + 1}`,
      text,
      done: false,
    })),
    verify: draft.verify,
  }));

  const violations = lintDecomposition(drafts);
  const mermaid = renderMermaid(tickets);

  return { tickets, violations, mermaid };
}
