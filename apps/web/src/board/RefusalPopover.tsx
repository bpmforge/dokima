import { explainRefusal, refusalFixAffordance } from './refusal.js';
import type { ProblemDetails } from './types.js';

export interface RefusalPopoverProps {
  ticketId: string;
  problem: ProblemDetails;
  onDismiss: () => void;
  onRunFix?: () => void;
}

/**
 * "explain-this-refusal" (UX_SPEC §4, FR-T4): the rule, the evidence, and —
 * where actionable — the fixing affordance. No drag ever bypasses this;
 * there is no "just move it" mode.
 */
export function RefusalPopover({
  ticketId,
  problem,
  onDismiss,
  onRunFix,
}: RefusalPopoverProps) {
  const explanation = explainRefusal(problem);
  const fix = refusalFixAffordance(problem);
  return (
    <div role="alert" className="board-refusal" data-testid={`refusal-${ticketId}`}>
      {/* W13-60: the human explanation LEADS. The rule id (an SRS FR/SC
          requirement name, written for the builder) stays visible as
          provenance — the e2e contract still asserts on it — but a novice
          reads why the board said no before they meet the code for it. */}
      <p className="board-refusal__detail">{explanation.message}</p>
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
