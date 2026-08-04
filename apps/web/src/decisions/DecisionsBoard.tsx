/**
 * Decision slate board (FR-P6): lists open slates as cards
 * (`apps/server/src/api/decisions/routes.ts`'s `GET
 * /projects/:id/slates?status=open`), and on choosing an option calls the
 * W5-13 `POST /slates/:id/decide` route and reflects the recorded decision
 * in place — no extra reload required, matching `artifacts/ArtifactViewerRoot.tsx`'s
 * optimistic-update-then-poll shape.
 */

import { useCallback, useEffect, useState } from 'react';
import { decideSlate, fetchSlates } from './api.js';
import './decisions.css';
import { SlateCard } from './SlateCard.js';
import type { SlateRecord } from './types.js';

export interface DecisionsBoardProps {
  projectId: string;
  token: string;
  /**
   * Fired after a slate is recorded. W10-72: the interview's awaiting screen
   * uses it to drop a stale "still awaiting a decision on …" notice, which
   * otherwise kept reading present-tense after the founder had answered.
   */
  onDecided?: () => void;
}

export function DecisionsBoard({ projectId, token, onDecided }: DecisionsBoardProps) {
  const [slates, setSlates] = useState<SlateRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideErrors, setDecideErrors] = useState<Record<string, string>>({});

  const opts = { getToken: () => token };

  const load = useCallback(async () => {
    try {
      const items = await fetchSlates(projectId, 'open', opts);
      setSlates(items);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (record: SlateRecord, chosen: string, rationale: string) => {
      setDecidingId(record.id);
      setDecideErrors((prev) => ({ ...prev, [record.id]: '' }));
      try {
        const result = await decideSlate(
          projectId,
          record.id,
          { chosen, rationale: rationale || undefined },
          opts,
        );
        setSlates((prev) =>
          prev.map((s) =>
            s.id === record.id
              ? {
                  ...s,
                  status: 'decided' as const,
                  chosen,
                  rationale: result.rationale || null,
                  d_id: result.d_id,
                }
              : s,
          ),
        );
        onDecided?.();
      } catch (err) {
        setDecideErrors((prev) => ({
          ...prev,
          [record.id]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setDecidingId(null);
      }
    },
    [onDecided, projectId, token],
  );

  return (
    <div className="decisions-board" data-testid="decisions-board">
      {loadError && <p role="alert">{loadError}</p>}
      {slates.length === 0 ? (
        <p className="decisions-board__empty" role="status">
          No decision slates yet — they appear when an agent hits a founder or technical
          fork.
        </p>
      ) : (
        <ul className="decisions-board__list">
          {slates.map((record) => (
            <li key={record.id}>
              <SlateCard
                record={record}
                onDecide={(chosen, rationale) => decide(record, chosen, rationale)}
                deciding={decidingId === record.id}
                error={decideErrors[record.id] || null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
