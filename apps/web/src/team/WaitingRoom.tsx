/**
 * The waiting room (W20-10, UX_SPEC §10a) — the queue made physical.
 *
 * Members whose ask is founder-facing sit in your office, in Otto's order;
 * seat index is queue position. This is deliberately uncomfortable in the
 * right way: four people sitting here means you are the bottleneck, and you
 * can see it without reading a badge.
 *
 * Members blocked on a PEER are absent by construction — the queue only ever
 * contains what is waiting on the founder (OPERATIONS.md's five classes), so
 * their absence is the visible difference between "blocked on you" and
 * "blocked".
 */
import type { FounderQueue } from './founderQueue.js';
import type { TeamMember } from './types.js';

export interface WaitingRoomProps {
  readonly queue: FounderQueue;
  readonly members: readonly TeamMember[];
  readonly onAnswer?: (row: { id: string; actorId: string }) => void;
}

function nameOf(members: readonly TeamMember[], actorId: string): string {
  const m = members.find(
    (x) => x.actorId === actorId || actorId.endsWith(`:${x.actorId}`),
  );
  // D-028: the face when there is one, the raw id when there is not.
  return m?.displayName ?? actorId;
}

export function WaitingRoom({ queue, members, onAnswer }: WaitingRoomProps) {
  if (queue.depth === 0) {
    return (
      <section className="surface team__waiting" data-testid="waiting-room">
        <h3>Your office</h3>
        <p className="team__waiting-empty" data-testid="waiting-empty">
          Nobody is waiting on you. Anyone stuck on a teammate is still at their
          desk — that is not yours to clear.
        </p>
      </section>
    );
  }

  return (
    <section className="surface team__waiting" data-testid="waiting-room">
      <h3>
        Your office — {queue.depth} waiting on you
      </h3>
      {/* D-030: the count is the true depth; the order is mechanical and
          nothing can be dropped, so this is the whole queue. */}
      <p className="team__waiting-why">
        In the order that unblocks the most work. Nothing is filtered out.
      </p>
      <ol className="team__chairs">
        {queue.rows.map((row) => (
          <li key={row.id} data-testid={`chair-${row.position}`} data-actor={row.actorId}>
            <span className="team__chair-seat" aria-hidden="true">
              {row.position}
            </span>
            <span className="team__chair-who">
              <b>{nameOf(members, row.actorId)}</b>
              <span className="team__chair-title">{row.title}</span>
              <span className="team__chair-reason">{row.reason}</span>
            </span>
            {onAnswer && (
              <button
                type="button"
                className="btn-primary"
                data-testid={`chair-answer-${row.position}`}
                onClick={() => onAnswer({ id: row.id, actorId: row.actorId })}
              >
                Answer
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
