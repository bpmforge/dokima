import { useEffect, useState } from 'react';
import { fetchBudget } from '../settings/api.js';
import { fetchApprovedBuildPreview } from './approvedBuildApi.js';

/**
 * What a run needs before the person clicks: the project's run limit (Review
 * A2) and whether a coding model resolves (Review UX-04). Split out of
 * BoardView.tsx to keep each file under the 400-line cap.
 */
export function useRunReadiness(baseUrl: string, token: string, projectId: string) {
  /**
   * Review A2: the project's real run limit, so an approval never reads "a
   * budget of $0.00" the person did not choose. `null` = no cap is set.
   */
  const [runLimitUsd, setRunLimitUsd] = useState<number | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  /**
   * Review UX-04: whether a maker model exists, read BEFORE the person
   * clicks — from the same preview read the approval shows, which resolves the
   * coding-agent model exactly as a run does. 'unknown' (read failed) leaves
   * the buttons enabled: the run's own refusal is still the honest backstop.
   */
  const [makerModel, setMakerModel] = useState<'unknown' | 'ready' | 'missing'>(
    'unknown',
  );

  useEffect(() => {
    let cancelled = false;
    setBudgetStatus('loading');
    fetchBudget(projectId, { getToken: () => token })
      .then((budget) => {
        if (cancelled) return;
        setRunLimitUsd(budget.runLimitUsd);
        setBudgetStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setBudgetStatus('error');
      });
    fetchApprovedBuildPreview({ baseUrl, token }, projectId, 0)
      .then((result) => {
        if (cancelled || !result.ok) return;
        setMakerModel(result.data.makerModel === null ? 'missing' : 'ready');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, projectId]);

  return { runLimitUsd, budgetStatus, noModel: makerModel === 'missing' };
}
