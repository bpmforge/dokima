/** UX_SPEC §2b empty-states table — copy quoted verbatim, not paraphrased. */

export function EmptyState({
  copy,
  action,
}: {
  copy: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="artifact-empty-state" role="status">
      <p>{copy}</p>
      {action && (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
