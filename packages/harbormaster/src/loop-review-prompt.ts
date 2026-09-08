/**
 * The reviewer's prompt and the reply parser (W23-04) — a chapter of
 * `loop-review.ts` under the 400-line CODE_BOOK_PROTOCOL cap. Extraction
 * only: no wording and no parsing rule changed in the move.
 *
 * Kept together because they are two halves of one contract. The prompt ends
 * by demanding a specific JSON shape and `parseVerdict` is the only thing that
 * reads it, so a change to either that is not a change to the other is a bug
 * — and putting them in one file makes that visible in one diff.
 */

import type { Ticket } from '@dokima/tickets';
import { formatRerunLine, type RerunEvidence } from '@dokima/loop';
import { reviewEvidenceSection, type ReviewEvidenceBundle } from './review-evidence.js';
import type { ReviewVerdictKind } from './loop-review.js';

/** Test-count extraction is best-effort; the contract only demands a non-empty counts record, and `commandsRun` is always true. */
export function countsFrom(output: string): Record<string, number> {
  const counts: Record<string, number> = { commandsRun: 1 };
  const passed = /(\d+)\s+(?:tests? )?pass(?:ed|ing)/i.exec(output);
  if (passed) counts.passed = Number(passed[1]);
  const failed = /(\d+)\s+(?:tests? )?fail(?:ed|ing)/i.exec(output);
  if (failed) counts.failed = Number(failed[1]);
  return counts;
}

export function reviewPrompt(
  ticket: Ticket,
  rerun: RerunEvidence,
  rerunOutputHead: string,
  evidence: ReviewEvidenceBundle,
  securitySection: string,
): string {
  const acceptance = ticket.acceptance
    .map((criterion) => `- ${criterion.text}`)
    .join('\n');
  const files = (ticket.manifest?.files ?? []).join(', ') || '(none listed)';
  return [
    `You are reviewing finished work on ticket ${ticket.id}: ${ticket.title}`,
    `Acceptance criteria:\n${acceptance || '- (none recorded)'}`,
    // W23-03: the DIFF, not a list of filenames. Before this the reviewer was
    // shown which files moved and asked whether the work was correct — a
    // question no reader of a file list can answer, and one a passing test
    // suite answers wrongly for any change that is insecure rather than broken.
    reviewEvidenceSection(evidence),
    securitySection,
    `Files changed (manifest): ${files}`,
    `Commits: ${(ticket.manifest?.commits ?? []).join(', ') || '(none)'}`,
    `The core re-ran the verify command independently: ${formatRerunLine(rerun)}`,
    `Verify output (head): ${rerunOutputHead}`,
    '',
    'Judge whether the work satisfies its acceptance criteria. Respond with',
    'ONLY a JSON object: {"verdict": "CONFIRMED"|"CONTRADICTED"|"UNVERIFIABLE",',
    '"score": 1-10, "reasoning": "<two sentences naming specific evidence>"}',
  ].join('\n');
}

export function parseVerdict(
  raw: string,
): { verdict: ReviewVerdictKind; score: number; reasoning: string } | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = parsed.verdict;
    const score = parsed.score;
    if (
      (verdict === 'CONFIRMED' ||
        verdict === 'CONTRADICTED' ||
        verdict === 'UNVERIFIABLE') &&
      typeof score === 'number' &&
      Number.isInteger(score) &&
      score >= 1 &&
      score <= 10
    ) {
      return {
        verdict,
        score,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}
