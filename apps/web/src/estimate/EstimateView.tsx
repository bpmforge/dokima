import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { EstimateApiError, fetchEstimate, postWhatIf } from './api.js';
import type { EstimateResult } from './types.js';

/** BLUEPRINT §3.3 role list (matches `estimate-routes.ts`'s `DEFAULT_ROLE_MATRIX`). */
const ROLE_OPTIONS = [
  'coding-agent',
  'code-reviewer',
  'challenger',
  'test-engineer',
  'pm-interviewer',
  'default',
] as const;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof EstimateApiError ? err.message : fallback;
}

export interface EstimateViewProps {
  token: string;
  projectId: string;
}

/**
 * Pre-autorun dry-run estimate (BLUEPRINT §12.2, FR-G7): per-wave
 * breakdown from real board tickets, with a what-if form that recomputes
 * the total deterministically when a role's $/point rate changes
 * ("$0.60 if the review role drops to Sonnet").
 */
export function EstimateView({ token, projectId }: EstimateViewProps) {
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>('code-reviewer');
  const [rate, setRate] = useState('0.15');
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchEstimate(projectId, { getToken: () => token });
      setEstimate(result);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load estimate'));
    } finally {
      setLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyWhatIf = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const usdPerPoint = Number(rate);
      if (!Number.isFinite(usdPerPoint) || usdPerPoint < 0) {
        setError('Rate must be a non-negative number');
        return;
      }
      setApplying(true);
      try {
        const result = await postWhatIf(
          projectId,
          { [role]: usdPerPoint },
          { getToken: () => token },
        );
        setEstimate(result);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Failed to recompute what-if'));
      } finally {
        setApplying(false);
      }
    },
    [projectId, rate, role, token],
  );

  if (loading) return null;

  return (
    <section className="estimate__section" data-testid="estimate-view">
      <h2>Dry-run estimate</h2>
      {error && (
        <p className="estimate__error" data-testid="estimate-error">
          {error}
        </p>
      )}
      {estimate && estimate.waves.length === 0 ? (
        <p className="estimate__empty" data-testid="estimate-empty">
          No tickets to estimate yet.
        </p>
      ) : (
        estimate && (
          <table className="estimate__table" data-testid="estimate-table">
            <thead>
              <tr>
                <th>Wave</th>
                <th>Tickets</th>
                <th>Points</th>
                <th>$/point</th>
                <th>Estimated</th>
              </tr>
            </thead>
            <tbody>
              {estimate.waves.map((wave) => (
                <tr key={wave.wave} data-testid={`estimate-wave-${wave.wave}`}>
                  <td>{wave.wave}</td>
                  <td>{wave.ticketCount}</td>
                  <td>{wave.totalPoints}</td>
                  <td>${wave.usdPerPoint.toFixed(2)}</td>
                  <td>${wave.estimatedUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total</td>
                <td data-testid="estimate-total">${estimate.totalUsd.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        )
      )}
      {estimate && estimate.assumptions.length > 0 && (
        <ul className="estimate__assumptions" data-testid="estimate-assumptions">
          {estimate.assumptions.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {estimate && estimate.waves.length > 0 && (
        <form
          className="estimate__what-if"
          data-testid="estimate-what-if-form"
          onSubmit={(e) => void applyWhatIf(e)}
        >
          <label>
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof ROLE_OPTIONS)[number])}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            $/point
            <input
              type="number"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <button type="submit" disabled={applying}>
            {applying ? 'Recomputing…' : 'What if?'}
          </button>
          <button type="button" onClick={() => void load()} disabled={applying}>
            Reset
          </button>
        </form>
      )}
    </section>
  );
}
