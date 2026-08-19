/**
 * loop-land-report.ts — how a park explains itself.
 *
 * Chapter of `loop-land.ts`, split at the 400-line CODE_BOOK_PROTOCOL cap
 * (W13-29). The seam is real: this is "write down what happened so a person
 * can act on it", while `loop-land.ts` is the ladder that decides when there
 * is something to write down.
 *
 * Worth keeping together for a second reason. Until W13-29 this was the ONLY
 * place a failure summary was ever produced — computed at the end, for a
 * human, after the ladder was already spent. The maker never saw any of it,
 * which is why every retry rendered a byte-identical prompt.
 */
import {
  renderDecideCard,
  tokenBoundaryDecideCard,
} from './loop-land-policy.js';
import type { LandAttempt, LandParkedReason } from './loop-land.js';

export function attemptSummaryLine(attempt: LandAttempt, ceiling: number): string {
  const gateSummary =
    attempt.closeGate === null
      ? 'no completion manifest returned'
      : attempt.closeGate.ok
        ? 'close gate passed'
        : `close gate refused: ${attempt.closeGate.reasons.join('; ')}`;
  return `attempt ${attempt.attempt}/${ceiling}: exitCode=${attempt.session.exitCode} ${gateSummary}`;
}

export function parkComment(
  reason: LandParkedReason,
  ceiling: number,
  attempts: readonly LandAttempt[],
  decideCard: ReturnType<typeof tokenBoundaryDecideCard> | undefined,
): string {
  const header =
    reason === 'locked_ceiling_reached'
      ? `auto-blocked with evidence: locked-mode convergence ceiling (${ceiling}) reached without a close (D-018).`
      : reason === 'awaiting_escalation_token'
        ? 'auto-blocked with evidence: token-gated escalation boundary reached without an approval token (D-018, FR-N2).'
        : `auto-blocked with evidence: ladder attempt cap (${ceiling}) reached without a close (FR-H1/H2).`;
  const lines = [
    header,
    ...attempts.map((attempt) => attemptSummaryLine(attempt, ceiling)),
  ];
  if (decideCard) lines.push('', renderDecideCard(decideCard));
  return lines.join('\n');
}
