/**
 * Answers a founder decision (slate) inline in the morning queue. Split out of
 * MorningQueue.tsx to keep each file under the 400-line cap.
 */
import { useEffect, useState } from 'react';
import { decideSlate, fetchSlates } from '../decisions/api.js';
import { SlateCard } from '../decisions/SlateCard.js';
import type { SlateRecord } from '../decisions/types.js';
import { NotificationsApiError } from './api.js';

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof NotificationsApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function SlateAnswer({
  projectId,
  slateId,
  onAnswered,
}: {
  projectId: string;
  slateId: string;
  onAnswered: () => void;
}) {
  const [record, setRecord] = useState<SlateRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  // Review Q2: a failed LOAD and a failed DECIDE are different. A failed
  // decide used to take the load-error branch and replace the options for
  // good; it now goes to SlateCard's own error line, options kept, retryable.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchSlates(projectId, 'open')
      .then((slates) => {
        if (!live) return;
        const found = slates.find((s) => s.id === slateId) ?? null;
        setRecord(found);
        setMissing(found === null);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errorMessage(err, 'Could not load this decision'));
      });
    return () => {
      live = false;
    };
  }, [projectId, slateId]);

  if (loadError) {
    return (
      <p className="notification-card__error" role="alert">
        {loadError}
      </p>
    );
  }
  if (missing) {
    return (
      <p className="notification-card__hint" role="status">
        Already answered — this card will clear on the next refresh.
      </p>
    );
  }
  if (!record) return null;

  return (
    <div data-testid={`queue-slate-${slateId}`}>
      <SlateCard
        record={record}
        deciding={deciding}
        error={decideError}
        onDecide={async (chosen: string, rationale: string) => {
          setDeciding(true);
          setDecideError(null);
          try {
            await decideSlate(projectId, slateId, {
              chosen,
              rationale: rationale || undefined,
            });
            // No manual resolve: W10-73's reconcile pass closes the card once
            // the slate is no longer open, so refreshing is the whole of it.
            onAnswered();
          } catch (err) {
            setDecideError(
              `Could not record that decision: ${errorMessage(err, 'the request failed')}`,
            );
          } finally {
            setDeciding(false);
          }
        }}
      />
    </div>
  );
}

/** UX_SPEC §2b positive-quiet, no CTA. W13-51: the closing clause used to be
 * "next digest at wave gate" — an internal term defined nowhere a user can
 * see, as the last words of the calmest screen in the product. The digest
 * arrives when the current run finishes, so say that. */
