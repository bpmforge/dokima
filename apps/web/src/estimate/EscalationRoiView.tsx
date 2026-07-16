import { useCallback, useEffect, useState } from 'react';
import { EstimateApiError, fetchSpendByRung } from './api.js';
import type { SpendByRungResult } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof EstimateApiError ? err.message : fallback;
}

export interface EscalationRoiViewProps {
  token: string;
  projectId: string;
}

/**
 * Escalation-ROI view (US-309, R-A2): spend grouped by rung, per ticket,
 * beside its outcome — "what did escalation buy". `GET .../spend?
 * group_by=rung` returns an honest-empty rollup until a spend ledger is
 * reachable from apps/server (estimate-routes.ts's module header); the
 * empty state surfaces that gap instead of hiding it.
 */
export function EscalationRoiView({ token, projectId }: EscalationRoiViewProps) {
  const [result, setResult] = useState<SpendByRungResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchSpendByRung(projectId, { getToken: () => token });
      setResult(res);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load escalation ROI'));
    }
  }, [projectId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="estimate__section" data-testid="escalation-roi-view">
      <h2>Escalation ROI</h2>
      {error && <p className="estimate__error">{error}</p>}
      {result && result.items.length === 0 ? (
        <p className="estimate__empty" data-testid="escalation-roi-empty">
          No escalation spend recorded yet.
        </p>
      ) : (
        result &&
        result.items.map((group) => (
          <div key={group.rung} data-testid={`escalation-roi-rung-${group.rung}`}>
            <h3>
              {group.rung} — ${group.totalUsd.toFixed(2)}
            </h3>
            <ul>
              {group.tickets.map((ticket) => (
                <li key={ticket.ticketId}>
                  {ticket.ticketId}: ${ticket.spendUsd.toFixed(2)} — {ticket.outcome}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {result && result.assumptions.length > 0 && (
        <ul className="estimate__assumptions" data-testid="escalation-roi-assumptions">
          {result.assumptions.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
