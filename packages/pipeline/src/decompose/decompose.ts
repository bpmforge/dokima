import { deriveLanes } from './lanes.js';
import { qualityTicketsFor } from './quality-tickets.js';
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
export interface DecomposeOptions {
  /**
   * Append the standard quality work (W21-97). OFF by default, because
   * `decompose()` has more than one caller and only one of them is planning a
   * product from an idea: `buildFixBacklog` (modes/improve.ts) turns AUDIT
   * FINDINGS into tickets, and adding "do a security review" to a backlog of
   * security findings is noise. The build pipeline opts in; nobody else does.
   */
  readonly includeQualityWork?: boolean;
}

export function decompose(
  drafts: readonly TicketDraftInput[],
  options: DecomposeOptions = {},
): DecomposedPlan {
  /**
   * W21-97: the quality work goes in the plan BY DEFAULT. A plan of nine
   * feature tickets that provisions VAPID keys and an authenticated cron
   * endpoint, with nothing reviewing either, is what decomposition produced
   * before this — and the person it produced it for may have no development
   * experience and would never think to ask.
   *
   * Appended here rather than requested in the prompt because a model's
   * compliance must not BE the guarantee — the same reason the close gate
   * re-runs verify instead of trusting the manifest. Anything the drafts
   * already cover is skipped, so a model that does think of a security review
   * does not get a second one.
   */
  const withQuality = options.includeQualityWork
    ? [...drafts, ...qualityTicketsFor(drafts)]
    : [...drafts];
  const lanes = deriveLanes(withQuality);

  const tickets: DecomposedTicket[] = withQuality.map((draft) => ({
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

  const violations = lintDecomposition(withQuality);
  const mermaid = renderMermaid(tickets);

  return { tickets, violations, mermaid };
}
