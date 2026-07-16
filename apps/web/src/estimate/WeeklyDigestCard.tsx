import { useCallback, useEffect, useState } from 'react';
import { EstimateApiError, fetchWeeklyDigest } from './api.js';
import type { WeeklyDigest } from './types.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof EstimateApiError ? err.message : fallback;
}

export interface WeeklyDigestCardProps {
  token: string;
  projectId: string;
}

/**
 * Weekly Review-tier digest card (US-309 AC-1; GATE_ECONOMICS §3):
 * escalation spend by rung plus suppression volume per rule — a demotion-
 * review input. Honest-empty until a spend ledger and rule/suppression
 * store are reachable from apps/server (estimate-routes.ts's module
 * header) — never a fabricated number in their place (C-1).
 */
export function WeeklyDigestCard({ token, projectId }: WeeklyDigestCardProps) {
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchWeeklyDigest(projectId, { getToken: () => token });
      setDigest(result);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load weekly digest'));
    }
  }, [projectId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!digest) return error ? <p className="estimate__error">{error}</p> : null;

  return (
    <section
      className="estimate__section estimate__digest-card"
      data-testid="weekly-digest-card"
      data-tier={digest.tier}
    >
      <h2>Weekly digest — {digest.weekOf}</h2>
      <span className="estimate__tier-badge" data-testid="weekly-digest-tier">
        {digest.tier}
      </span>
      <p data-testid="weekly-digest-total">
        Total spend: ${digest.totalSpendUsd.toFixed(2)}
      </p>
      {digest.byRung.length === 0 ? (
        <p className="estimate__empty" data-testid="weekly-digest-rung-empty">
          No escalation spend this week.
        </p>
      ) : (
        <ul>
          {digest.byRung.map((group) => (
            <li key={group.rung}>
              {group.rung}: ${group.totalUsd.toFixed(2)}
            </li>
          ))}
        </ul>
      )}
      <h3>Suppression volume per rule</h3>
      {digest.suppressionVolume.length === 0 ? (
        <p className="estimate__empty" data-testid="weekly-digest-suppression-empty">
          No suppressions recorded this week.
        </p>
      ) : (
        <ul data-testid="weekly-digest-suppression-list">
          {digest.suppressionVolume.map((row) => (
            <li key={row.ruleId}>
              {row.ruleId}: {row.count}
            </li>
          ))}
        </ul>
      )}
      {digest.assumptions.length > 0 && (
        <ul className="estimate__assumptions" data-testid="weekly-digest-assumptions">
          {digest.assumptions.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
