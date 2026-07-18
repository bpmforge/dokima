import { useState } from 'react';
import type { BoardTicket } from '../types.js';
import type { DagEditResult } from './types.js';

export interface DagEditPanelProps {
  ticketId: string;
  dependsOn: string[];
  allTickets: readonly BoardTicket[];
  onSubmit: (dependsOn: string[]) => Promise<DagEditResult>;
}

/**
 * Pre-build DAG edit (UX_SPEC §4 "reprioritize" — the one of split/merge/
 * reprioritize this ticket can actually deliver end-to-end, see
 * `../drawer/api.ts`'s `patchDependsOn` module header): a chip list of
 * current dependencies, add/remove, Save — refusals (unknown ticket,
 * cycle) render inline with the same rule+detail explain pattern the
 * board's own `RefusalPopover` uses.
 */
export function DagEditPanel({
  ticketId,
  dependsOn,
  allTickets,
  onSubmit,
}: DagEditPanelProps) {
  const [draft, setDraft] = useState<string[]>(dependsOn);
  const [addValue, setAddValue] = useState('');
  const [result, setResult] = useState<DagEditResult | null>(null);
  const [saving, setSaving] = useState(false);

  const candidates = allTickets
    .map((t) => t.id)
    .filter((id) => id !== ticketId && !draft.includes(id));

  const removeDep = (id: string) =>
    setDraft((current) => current.filter((d) => d !== id));
  const addDep = () => {
    if (addValue.trim().length === 0) return;
    setDraft((current) => [...current, addValue.trim()]);
    setAddValue('');
  };

  const save = async () => {
    setSaving(true);
    setResult(null);
    const outcome = await onSubmit(draft);
    setResult(outcome);
    setSaving(false);
  };

  return (
    <div className="ticket-drawer__dag-edit" data-testid="dag-edit-panel">
      <ul className="ticket-drawer__dag-chips">
        {draft.map((dep) => (
          <li key={dep} className="ticket-drawer__dag-chip">
            {dep}{' '}
            <button
              type="button"
              aria-label={`Remove dependency on ${dep}`}
              onClick={() => removeDep(dep)}
            >
              ×
            </button>
          </li>
        ))}
        {draft.length === 0 && <li className="ticket-drawer__empty">No dependencies</li>}
      </ul>
      <div className="ticket-drawer__dag-add">
        <label>
          <span className="sr-only">Add a dependency (ticket id)</span>
          <input
            list={`dag-edit-candidates-${ticketId}`}
            value={addValue}
            onChange={(event) => setAddValue(event.target.value)}
            placeholder="Ticket id"
          />
        </label>
        <datalist id={`dag-edit-candidates-${ticketId}`}>
          {candidates.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <button type="button" onClick={addDep}>
          Add
        </button>
      </div>
      <button type="button" onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save dependencies'}
      </button>
      {result && (
        <p
          role="alert"
          className={`ticket-drawer__dag-result ticket-drawer__dag-result--${result.kind}`}
          data-testid="dag-edit-result"
        >
          {result.kind === 'refused' && (
            <>
              <strong>{result.rule}</strong>: {result.detail}
            </>
          )}
          {result.kind === 'not-persisted' && <>Validated — {result.detail}</>}
          {result.kind === 'error' && <>Error: {result.detail}</>}
        </p>
      )}
    </div>
  );
}
