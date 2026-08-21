/**
 * W19-06: the matrix Fitness cell — chapter of ModelMatrixPanel (400 cap).
 * The column earned its action: Bench POSTs models/bench (the W19-03
 * producer), which runs the role's fixture tasks against the configured
 * model and persists the card the Roster reads; the returned verdict fills
 * the cell. Until benched THIS visit the cell still says "not benched"
 * honestly — persisted verdicts render in Roster; hydrating them here is a
 * follow-up, not a fabrication (C-1).
 */

export interface MatrixFitnessCellProps {
  readonly role: string;
  readonly taskType: string;
  /** undefined = never benched this visit; 'running' | 'failed' | a verdict. */
  readonly state: string | undefined;
  readonly onBench: () => void;
}

export function MatrixFitnessCell({ role, taskType, state, onBench }: MatrixFitnessCellProps) {
  if (state === 'running') {
    return <span className="settings__badge settings__badge--muted">benching…</span>;
  }
  if (state && state !== 'failed') {
    return (
      <span className="settings__badge" data-testid={`bench-verdict-${role}-${taskType}`}>
        {state}
      </span>
    );
  }
  return (
    <>
      <span className="settings__badge settings__badge--muted">
        {state === 'failed' ? 'bench failed' : 'not benched'}
      </span>{' '}
      <button
        type="button"
        data-testid={`bench-${role}-${taskType}`}
        title="Runs this role’s fixture tasks against the configured model and records the verdict — nothing else changes."
        onClick={onBench}
      >
        Bench
      </button>
    </>
  );
}
