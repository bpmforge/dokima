import { explainRefusal, refusalFixAffordance } from './refusal.js';
import type { ProblemDetails } from './types.js';

export interface RefusalPopoverProps {
  ticketId: string;
  problem: ProblemDetails;
  onDismiss: () => void;
  onRunFix?: () => void;
}

/** The evidence minus `fix` (which is shown as its own line), or null when nothing is left to show. */
function evidenceToShow(evidence: unknown): unknown {
  if (evidence === null || evidence === undefined) return null;
  if (typeof evidence === 'object' && !Array.isArray(evidence)) {
    const rest = Object.fromEntries(
      Object.entries(evidence as Record<string, unknown>).filter(([key]) => key !== 'fix'),
    );
    return Object.keys(rest).length > 0 ? rest : null;
  }
  return evidence;
}

/**
 * "explain-this-refusal" (UX_SPEC §4, FR-T4): the rule, the evidence, and —
 * where actionable — the fixing affordance. No drag ever bypasses this;
 * there is no "just move it" mode.
 *
 * Review F1: `explainRefusal` extracted the evidence and nothing rendered it,
 * and the fix showed only as a button no caller ever wired — so a person saw
 * a sentence and a rule id, never what the board checked or what to do. The
 * evidence is now one disclosure away, and the fix is always stated: as a
 * button when the caller has an action for it, otherwise as an instruction.
 */
export function RefusalPopover({
  ticketId,
  problem,
  onDismiss,
  onRunFix,
}: RefusalPopoverProps) {
  const explanation = explainRefusal(problem);
  const fix = refusalFixAffordance(problem);
  const evidence = evidenceToShow(explanation.evidence);
  return (
    <div role="alert" className="board-refusal" data-testid={`refusal-${ticketId}`}>
      {/* W13-60: the human explanation LEADS. The rule id (an SRS FR/SC
          requirement name, written for the builder) stays visible as
          provenance — the e2e contract still asserts on it — but a novice
          reads why the board said no before they meet the code for it. */}
      <p className="board-refusal__ticket" data-testid="refusal-ticket">
        {ticketId} can&apos;t move:
      </p>
      <p className="board-refusal__detail">{explanation.message}</p>
      {fix && !onRunFix && (
        <p className="board-refusal__fix" data-testid="refusal-fix">
          To fix: {fix}
        </p>
      )}
      {evidence !== null && (
        <details className="board-refusal__evidence" data-testid="refusal-evidence">
          <summary>What the board checked</summary>
          <pre>
            {typeof evidence === 'string' ? evidence : JSON.stringify(evidence, null, 2)}
          </pre>
        </details>
      )}
      <p className="board-refusal__rule board-refusal__rule--tag">
        rule: {explanation.rule}
      </p>
      <div className="board-refusal__actions">
        {fix && onRunFix && (
          <button type="button" onClick={onRunFix}>
            {fix}
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
