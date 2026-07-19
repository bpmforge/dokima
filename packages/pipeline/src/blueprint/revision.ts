/**
 * The blueprint revision loop (FR-P7 / AC-3: "each answer cycle produces a
 * revised blueprint version with diff"). `resolveOpenQuestion` performs one
 * cycle: the founder decided a slate (via `../decisions` — a real D-ID was
 * minted and appended to the ledger elsewhere, out of this write_scope's
 * reach), and that answer replaces its question's UNRESOLVED marker line
 * with a RESOLVED one, bumping the document version.
 *
 * "With diff" (US-102 AC-3 / UC-10 step 2) is an artifact-viewer concern
 * (FR-C3), not something this module re-implements — a hand-rolled diff
 * algorithm here would just be a second, untested copy of what the viewer
 * already owns. `BlueprintRevisionResult` returns the full `before` and
 * `after` markdown so the viewer can diff them directly.
 */
import { formatResolvedMarkerLine, unresolvedMarkerLineRegex } from './markers.js';
import type { BlueprintDocument } from './types.js';

export class UnknownOpenQuestionError extends Error {
  constructor(key: string) {
    super(
      `no unresolved founder-decision marker found for key "${key}" — either it was never ` +
        'part of this blueprint or it is already resolved',
    );
    this.name = 'UnknownOpenQuestionError';
  }
}

export interface ResolveOpenQuestionInput {
  readonly key: string;
  /** The question text, as shown on the slate card (e.g. `slate.title` from `synth.ts`). */
  readonly question: string;
  readonly decisionId: string;
  /** Short human-readable summary of the decision, rendered inline in the resolved bullet. */
  readonly decisionSummary: string;
}

export interface BlueprintRevisionResult {
  readonly document: BlueprintDocument;
  readonly before: string;
}

/**
 * Replaces `input.key`'s UNRESOLVED marker line with a RESOLVED one citing
 * `input.decisionId`, in place — every other line is preserved byte-for-
 * byte. Throws `UnknownOpenQuestionError` for a key with no live UNRESOLVED
 * marker (unknown key, already resolved, or ambiguous/malformed — none of
 * those are single, unambiguous lines this function may safely rewrite).
 */
export function resolveOpenQuestion(
  document: BlueprintDocument,
  input: ResolveOpenQuestionInput,
): BlueprintRevisionResult {
  const lines = document.markdown.split('\n');
  const marker = unresolvedMarkerLineRegex(input.key);
  const index = lines.findIndex((line) => marker.test(line));
  if (index === -1) {
    throw new UnknownOpenQuestionError(input.key);
  }

  const newLines = [...lines];
  newLines[index] = formatResolvedMarkerLine(
    input.key,
    input.question,
    input.decisionId,
    input.decisionSummary,
  );

  return {
    document: { version: document.version + 1, markdown: newLines.join('\n') },
    before: document.markdown,
  };
}
