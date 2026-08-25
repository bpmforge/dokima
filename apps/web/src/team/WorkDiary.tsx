/**
 * A member's work diary (W20-03) — their own event slice, humanised.
 *
 * Every line links to the trace that produced it, so the face never becomes a
 * claim you cannot check. An empty diary says so plainly rather than rendering
 * a hopeful blank (UX_SPEC §10's "every state, written").
 */
import type { DiaryEntry } from './diary.js';

export interface WorkDiaryProps {
  readonly displayName: string;
  readonly entries: readonly DiaryEntry[];
  readonly total: number;
  readonly onOpenTrace?: (ticketId: string) => void;
}

function timeOf(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? at
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function WorkDiary({
  displayName,
  entries,
  total,
  onOpenTrace,
}: WorkDiaryProps) {
  if (entries.length === 0) {
    return (
      <p className="team__diary-empty" data-testid="diary-empty">
        {displayName} hasn&rsquo;t done anything on this project yet.
      </p>
    );
  }
  return (
    <div className="team__diary" data-testid="work-diary">
      <ul className="team__diary-list">
        {entries.map((e) => (
          <li key={e.seq} data-testid={`diary-entry-${e.seq}`}>
            <time dateTime={e.at}>{timeOf(e.at)}</time>
            <span className="team__diary-line">
              {e.line}
              {e.ticketId && <span className="team__diary-ticket"> {e.ticketId}</span>}
              {/* The receipt is the proof; it appears only when one was minted. */}
              {e.receiptId && (
                <span className="team__diary-receipt"> receipt {e.receiptId}</span>
              )}
            </span>
            {e.ticketId && onOpenTrace && (
              <button
                type="button"
                className="btn-quiet team__diary-evidence"
                data-testid={`diary-evidence-${e.seq}`}
                onClick={() => onOpenTrace(e.ticketId!)}
                title={`Open the trace this line came from (${e.eventType})`}
              >
                evidence
              </button>
            )}
          </li>
        ))}
      </ul>
      {total > entries.length && (
        <p className="team__diary-more" data-testid="diary-more">
          Showing the most recent {entries.length} of {total}.
        </p>
      )}
    </div>
  );
}
