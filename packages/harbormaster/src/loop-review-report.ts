/**
 * What the ticket is TOLD about its review (W23-10) — a chapter of
 * `loop-review.ts` under the 400-line cap. Extraction only: the same sentences,
 * assembled from named facts instead of from local variables.
 *
 * The order matters and is preserved: the verdict line first, then whichever
 * caveats apply, then the reviewer's own reasoning. A caveat placed after the
 * reasoning reads as a footnote to it; placed before, it frames it — and the
 * caveats here ("the gate failed", "the reviewer never saw the code") are the
 * frame, not the footnote.
 */

import type { ReviewVerdictKind } from './loop-review.js';
import type { ReviewSignalAction } from '@dokima/loop';

export interface ReviewCommentFacts {
  readonly verdict: ReviewVerdictKind;
  readonly score: number;
  readonly action: ReviewSignalAction | undefined;
  readonly reasoning: string;
  readonly rerunLine: string;
  readonly reviewerModel: string | null;
  readonly makerModel: string;
  readonly overclaiming: boolean;
  readonly gatePassed: boolean;
  readonly rerunExitCode: number | null;
  readonly evidenceUsable: boolean;
  readonly evidenceComplete: boolean;
  readonly evidenceReason: string | null;
}

export function reviewCommentBody(facts: ReviewCommentFacts): string {
  const lines = [
    `Review verdict: ${facts.verdict} (score ${facts.score}/10${
      facts.action ? ` — ${facts.action}` : ''
    }) — reviewed by ${facts.reviewerModel}; maker ${facts.makerModel}`,
    facts.rerunLine,
    facts.reasoning,
  ];
  if (facts.overclaiming && facts.action === 'ESCALATE_TO_HUMAN') {
    lines.splice(
      1,
      0,
      `Escalated to you: this maker (${facts.makerModel}) has historically claimed done more often than the gate confirmed, so its borderline work gets a person's eyes (FR-L3).`,
    );
  }
  if (!facts.gatePassed) {
    lines.splice(
      1,
      0,
      `The core's independent re-run FAILED (exit ${facts.rerunExitCode}) — the verdict is CONTRADICTED by construction; the model's opinion cannot out-vote the gate.`,
    );
  }
  if (!facts.evidenceUsable) {
    lines.splice(
      1,
      0,
      !facts.evidenceComplete
        ? `The reviewer was NOT shown the source change: ${facts.evidenceReason}. A CONFIRMED on this evidence is recorded as UNVERIFIABLE.`
        : `The worktree changed while the review was running, so the verdict describes code that is no longer there; recorded as UNVERIFIABLE.`,
    );
  }
  return lines.filter(Boolean).join('\n');
}
