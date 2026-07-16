import { BOARD_EMPTY_STATE } from './emptyState.js';

export interface EmptyStateProps {
  onViewCurrentPhase?: () => void;
}

/** Board empty state (UX_SPEC §2b): pre-decomposition, no tickets yet. */
export function EmptyState({ onViewCurrentPhase }: EmptyStateProps) {
  return (
    <div className="board-empty" data-testid="board-empty">
      <p>{BOARD_EMPTY_STATE.message}</p>
      {onViewCurrentPhase && (
        <button type="button" onClick={onViewCurrentPhase}>
          {BOARD_EMPTY_STATE.actionLabel}
        </button>
      )}
    </div>
  );
}
