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
      <p className="board-refusal__rule">{explanation.rule}</p>
      <p className="board-refusal__detail">{explanation.message}</p>
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
