/**
 * session-anchors.ts — external ground truth, restated to the model each round.
 *
 * Extracted from `gateway-session.ts` (W13-23), which was at 399 of the
 * 400-line cap with this inline, so the composition could not grow to hold a
 * second anchor. BLUEPRINT §3.5 composes an anchor SET; one anchor hard-coded
 * at a call site is not a set.
 *
 * WHY A SECOND ANCHOR CHANGES THE CONTROL FLOW. The old block began
 * `if (validatorResults.length === 0) return;` — correct while the tool anchor
 * was the only one, because before any verify has run there is nothing to
 * state. It is wrong for memory: recall is most valuable on the FIRST turn,
 * before the model has done anything, and that early return is precisely when
 * it would have been skipped. So the emptiness test moved to where it belongs
 * — after gathering, on the facts themselves.
 *
 * `harbormaster` may not import `memory` (ARCHITECTURE §4), so the memory
 * anchor arrives as an injected `Anchor`, composed in `apps/server` where both
 * packages are declared. Same seam and same reasoning as W12-04's
 * `HandoffBuilder`; no dependency-matrix amendment.
 */
import {
  anchorIsPresent,
  createToolAnchor,
  formatAnchorFactsForPrompt,
  gatherAnchorFacts,
  type Anchor,
  type ValidatorResult,
} from '@dokima/loop';
import { redactDeep } from '@dokima/shared';

export interface AnchorRefreshInput {
  /** Validator results so far — empty until the first `verify` has run. */
  readonly validatorResults: readonly ValidatorResult[];
  /** Injected because harbormaster cannot construct one (ARCHITECTURE §4). */
  readonly memoryAnchor?: Anchor;
  readonly ticketId: string;
  readonly itemDescription: string;
  readonly criterion: string;
  readonly secretValues?: readonly string[];
}

/**
 * The anchor block for this round, or `null` when no anchor has anything to
 * say. Returning the content rather than mutating the transcript keeps the
 * "exactly one anchor block, always adjacent to the current turn" rule in one
 * place — its caller's.
 */
export async function buildAnchorBlock(
  input: AnchorRefreshInput,
): Promise<string | null> {
  const anchors: Anchor[] = [];
  if (input.validatorResults.length > 0) {
    anchors.push(createToolAnchor(input.validatorResults));
  }
  if (input.memoryAnchor) anchors.push(input.memoryAnchor);
  if (anchors.length === 0) return null;

  const facts = await gatherAnchorFacts(anchors, {
    item: { id: input.ticketId, description: input.itemDescription },
    criterion: input.criterion,
  });
  if (!anchorIsPresent(facts)) return null;

  /**
   * REDACTED HERE, and not merely inherited (FR-S2/SC-06). `verifyTool`
   * redacts its own stdout/stderr, but an anchor fact also embeds the verify
   * COMMAND TEXT as its source label — read straight off the ticket record, so
   * it never passed through `renderHandoff`'s `redactDeep` pass the way the
   * prompt's copy did. A secret-bearing verify command would otherwise be
   * reintroduced to the model by the very mechanism meant to state ground
   * truth. Caught by W11-14's red fixture when the anchor was first wired.
   *
   * It now covers recalled memory facts too, which is a second reason to keep
   * it: a fact stored before a secret was registered would otherwise be read
   * back out unredacted.
   */
  return redactDeep(formatAnchorFactsForPrompt(facts), input.secretValues ?? []);
}
