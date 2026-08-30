import { useState } from 'react';
import { BOARD_EMPTY_STATE } from './emptyState.js';

export interface EmptyStateProps {
  onViewCurrentPhase?: () => void;
  /**
   * Runs the onboard analysis (W21-95). Resolves to a refusal string when the
   * product cannot do it — no model configured is the case A4 names — and to
   * `undefined` when it ran. It returns the reason rather than throwing so the
   * panel can SHOW it: a swallowed failure here would leave an empty board
   * looking exactly like a successful analysis that found nothing, which is
   * the defect this whole ticket is about.
   */
  onAnalyseRepository?: () => Promise<string | undefined>;
}

type AnalysisState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'refused'; reason: string };

/** Board empty state (UX_SPEC §2b): pre-decomposition, no tickets yet. */
export function EmptyState({ onViewCurrentPhase, onAnalyseRepository }: EmptyStateProps) {
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'idle' });

  const analyse = async () => {
    if (!onAnalyseRepository) return;
    setAnalysis({ kind: 'running' });
    const refusal = await onAnalyseRepository();
    setAnalysis(refusal ? { kind: 'refused', reason: refusal } : { kind: 'idle' });
  };

  return (
    <div className="board-empty" data-testid="board-empty">
      <p>{BOARD_EMPTY_STATE.message}</p>
      {onViewCurrentPhase && (
        <button type="button" onClick={onViewCurrentPhase}>
          {BOARD_EMPTY_STATE.actionLabel}
        </button>
      )}
      {onAnalyseRepository && analysis.kind !== 'running' && (
        <button type="button" onClick={() => void analyse()}>
          {BOARD_EMPTY_STATE.analyseLabel}
        </button>
      )}
      {analysis.kind === 'running' && (
        <p data-testid="board-empty-analysing">{BOARD_EMPTY_STATE.analysingLabel}</p>
      )}
      {analysis.kind === 'refused' && (
        // A4: the product's own words. Saying "could not analyse" and dropping
        // the reason would be the same silence in a politer register.
        <p className="state state--refused" data-testid="board-empty-analysis-refused">
          {analysis.reason}
        </p>
      )}
    </div>
  );
}
