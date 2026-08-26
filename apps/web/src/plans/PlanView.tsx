import { useCallback, useEffect, useState } from 'react';
import { acceptPlanItem, dismissPlanItem, fetchPlan, PlansApiError } from './api.js';
import {
  canAccept,
  canDismiss,
  describeVerifyCriterion,
  funnelSummary,
  scoresVary,
  STATE_LABEL,
} from './format.js';
import type { PlanItem } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof PlansApiError ? err.message : fallback;
}

interface AcceptFormProps {
  onSubmit: (lane: string) => void;
  onCancel: () => void;
  busy: boolean;
}

function AcceptForm({ onSubmit, onCancel, busy }: AcceptFormProps) {
  const [lane, setLane] = useState('');
  return (
    <form
      className="plan-item__accept-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (lane.trim()) onSubmit(lane.trim());
      }}
    >
      <label>
        Lane
        <input
          value={lane}
          onChange={(event) => setLane(event.target.value)}
          placeholder="e.g. pipeline"
          data-testid="plan-accept-lane-input"
          required
        />
      </label>
      <button type="submit" disabled={busy || !lane.trim()}>
        Confirm accept
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

interface DismissFormProps {
  onSubmit: (note: string) => void;
  onCancel: () => void;
  busy: boolean;
}

function DismissForm({ onSubmit, onCancel, busy }: DismissFormProps) {
  const [note, setNote] = useState('');
  return (
    <form
      className="plan-item__dismiss-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (note.trim()) onSubmit(note.trim());
      }}
    >
      <label>
        Reason
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="why this doesn't apply"
          data-testid="plan-dismiss-note-input"
          required
        />
      </label>
      <button type="submit" disabled={busy || !note.trim()}>
        Confirm dismiss
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

interface PlanItemRowProps {
  item: PlanItem;
  /** W13-50: identical scores on every card are noise wearing authority — rendered only when they rank. */
  showScores: boolean;
  openForm: 'accept' | 'dismiss' | null;
  busy: boolean;
  onOpenForm: (form: 'accept' | 'dismiss' | null) => void;
  onAccept: (lane: string) => void;
  onDismiss: (note: string) => void;
}

function PlanItemRow({
  item,
  showScores,
  openForm,
  busy,
  onOpenForm,
  onAccept,
  onDismiss,
}: PlanItemRowProps) {
  return (
    <li className="plan-item" data-testid={`plan-item-${item.id}`}>
      {/* W13-50 (UX_AUDIT A-2): ONE id per card. This header used to show
          both the catalog id AND "Ticket: PLAN-T001" — two names for one
          thing on one card, the exact defect VOCABULARY.md exists to
          prevent. The board's word wins once a ticket exists; the catalog id
          appears only while there is nothing else to call the item. */}
      <header className="plan-item__header">
        <span className="plan-item__catalog-id" data-testid={`plan-item-${item.id}-ticket`}>
          {item.ticketId ?? item.catalogId}
        </span>
        <span className={`plan-item__state plan-item__state--${item.state}`}>
          {STATE_LABEL[item.state]}
        </span>
      </header>
      <p className="plan-item__recommendation">{item.recommendation}</p>
      {/* W13-59: the sentence a person can decide on leads; the machine
          expression stays as secondary detail. */}
      <p className="plan-item__verify">
        {describeVerifyCriterion(item.verifyCriterion)}{' '}
        <code className="plan-item__verify-expr">{item.verifyCriterion}</code>
      </p>
      {showScores && (
        <p className="plan-item__meta">
          severity {item.severity} · leverage {item.leverage} · priority score {item.rank}
        </p>
      )}
      {!openForm && (
        <div className="plan-item__actions">
          {canAccept(item.state) && (
            <button type="button" onClick={() => onOpenForm('accept')} disabled={busy}>
              Accept
            </button>
          )}
          {canDismiss(item.state) && (
            <button type="button" onClick={() => onOpenForm('dismiss')} disabled={busy}>
              Dismiss
            </button>
          )}
          {/* W13-59: what each choice actually does (mechanism-true —
              acceptItem mints a board ticket; dismiss records the reason). */}
          {(canAccept(item.state) || canDismiss(item.state)) && (
            <p
              className="plan-item__consequence"
              data-testid={`plan-item-${item.id}-consequence`}
            >
              Accept creates a ticket on the board in the lane you choose.
              Dismiss records your reason and sets the suggestion aside —
              nothing on the board changes.
            </p>
          )}
        </div>
      )}
      {openForm === 'accept' && (
        <AcceptForm onSubmit={onAccept} onCancel={() => onOpenForm(null)} busy={busy} />
      )}
      {openForm === 'dismiss' && (
        <DismissForm onSubmit={onDismiss} onCancel={() => onOpenForm(null)} busy={busy} />
      )}
    </li>
  );
}

export interface PlanViewProps {
  projectId: string;
}

/**
 * The Improvement Plan (FR-PLAN2/4, D-016): ranked items with catalog
 * provenance, verify criterion, state, linked ticket, and accept/dismiss
 * actions — fully functional with zero LLM calls (AC1). Item creation
 * (catalog evaluation against a live snapshot) and re-verification are
 * `@dokima/pipeline`-engine primitives this view does not trigger
 * itself (W5-15 wires the run-completion/nightly caller); this screen only
 * ever reads and mutates what the store already has.
 */
export function PlanView({ projectId }: PlanViewProps) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [funnel, setFunnel] = useState({
    rawFindings: 0,
    planItems: 0,
    accepted: 0,
    done: 0,
    regressed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<{
    itemId: string;
    form: 'accept' | 'dismiss';
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await fetchPlan(projectId);
      setItems(result.items);
      setFunnel(result.funnel);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the plan'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const handleAccept = useCallback(
    async (itemId: string, lane: string) => {
      setBusyId(itemId);
      try {
        await acceptPlanItem(projectId, itemId, { lane });
        setOpenForm(null);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Failed to accept plan item'));
      } finally {
        setBusyId(null);
      }
    },
    [projectId, refresh],
  );

  const handleDismiss = useCallback(
    async (itemId: string, note: string) => {
      setBusyId(itemId);
      try {
        await dismissPlanItem(projectId, itemId, note);
        setOpenForm(null);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Failed to dismiss plan item'));
      } finally {
        setBusyId(null);
      }
    },
    [projectId, refresh],
  );

  return (
    <div className="page plan-view" data-testid="plan-view">
      <header className="plan-view__header">
        <h2>Improvement plan</h2>
        <p className="plan-view__funnel" data-testid="plan-funnel">
          {funnelSummary(funnel)}
        </p>
      </header>

      {error && (
        <p className="plan-view__error" role="alert">
          {error}
        </p>
      )}

      {!loading && items.length === 0 ? (
        <p className="plan-view__empty" data-testid="plan-empty">
          No plan items yet. They appear here once a run or nightly auto-verify evaluates
          the recommendation catalog against this project.
        </p>
      ) : (
        <ul className="plan-view__list" data-testid="plan-list">
          {items.map((item) => (
            <PlanItemRow
              key={item.id}
              item={item}
              showScores={scoresVary(items)}
              openForm={openForm?.itemId === item.id ? openForm.form : null}
              busy={busyId === item.id}
              onOpenForm={(form) => setOpenForm(form ? { itemId: item.id, form } : null)}
              onAccept={(lane) => void handleAccept(item.id, lane)}
              onDismiss={(note) => void handleDismiss(item.id, note)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
