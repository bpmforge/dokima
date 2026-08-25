/**
 * The List view (W20-11, UX_SPEC §10a) — the same truth, in words.
 *
 * This is the ACCESSIBILITY BASELINE, not a lesser sibling: a real table, no
 * canvas, keyboard-operable, screen-reader-labelled. The spec's rule is that
 * any state the office can animate, the List renders in text — a state that
 * exists only as an animation is a spec violation, and `stateLabel` below is
 * the total function that makes that checkable (its parity test enumerates
 * ALL_MEMBER_STATES).
 */
import {
  deriveMemberState,
  type FounderAsk,
  type MemberStateKind,
} from './memberState.js';
import type { BoardTicket, HeartbeatData } from '../board/types.js';
// The List is the complete view (§10a): org first, then every other member —
// no summary here, because a table row per member IS the accessible answer.
import { partitionOrg } from './partition.js';
import type { TeamMember } from './types.js';

/** One human phrase per state. Total by construction — no default branch. */
const STATE_LABEL: Record<MemberStateKind, string> = {
  'blocked-on-you': 'Waiting on you',
  working: 'Working',
  reading: 'Reading',
  'self-checking': 'Checking their own work',
  'in-review': 'Reviewing someone else’s work',
  submitted: 'Handed in — someone else is reviewing',
  assigned: 'Holding a ticket — nothing running on it',
  shipped: 'Shipped',
  idle: 'Nothing assigned',
};

export function stateLabel(kind: MemberStateKind): string {
  return STATE_LABEL[kind];
}

export interface QueueRow {
  readonly id: string;
  readonly position: number;
  readonly actorId: string;
  readonly kind: string;
  readonly title: string;
  readonly reason: string;
}

export interface TeamListProps {
  readonly members: readonly TeamMember[];
  readonly tickets: readonly BoardTicket[];
  readonly heartbeats: ReadonlyMap<string, HeartbeatData>;
  readonly asks: readonly FounderAsk[];
  /** Otto's ordered queue (W20-09). Depth is `queue.length` — never truncated. */
  readonly queue: readonly QueueRow[];
  readonly onAnswer?: (actorId: string) => void;
  readonly onSelect?: (actorId: string) => void;
}

export function TeamList({
  members,
  tickets,
  heartbeats,
  asks,
  queue,
  onAnswer,
  onSelect,
}: TeamListProps) {
  const split = partitionOrg(members);
  const orderedMembers = [...split.org, ...split.others];
  return (
    <div className="team-list" data-testid="team-list">
      <section aria-labelledby="needs-you-heading" className="team-list__queue surface">
        <h3 id="needs-you-heading">Needs you — {queue.length} waiting</h3>
        {/* D-030: the order is mechanical and the coordinator cannot drop an
            item, so this count is the true depth. */}
        <p className="team-list__why">
          Ordered by what unblocks the most work. Nothing is filtered out.
        </p>
        {queue.length === 0 ? (
          <p data-testid="queue-empty">Nothing is waiting on you.</p>
        ) : (
          <ol className="team-list__queue-rows">
            {queue.map((q) => (
              <li key={q.id} data-testid={`queue-row-${q.id}`}>
                <span className="team-list__pos" aria-hidden="true">
                  {q.position}
                </span>
                <span>
                  <b>{q.title}</b>
                  <span className="team-list__meta">
                    {' '}
                    {q.kind} — {q.reason}
                  </span>
                </span>
                {onAnswer && (
                  <button
                    type="button"
                    className="btn-primary"
                    data-testid={`queue-answer-${q.id}`}
                    onClick={() => onAnswer(q.actorId)}
                  >
                    Answer
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <table className="team-list__table">
        <caption className="sr-only">
          Every member of the team, their current state, and what they do
        </caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">State</th>
            <th scope="col">Working on</th>
            <th scope="col">Job</th>
          </tr>
        </thead>
        <tbody>
          {orderedMembers.map((m) => {
            const state = deriveMemberState({
              actorId: m.actorId,
              tickets,
              heartbeats,
              asks,
            });
            return (
              <tr key={m.actorId} data-testid={`list-row-${m.actorId}`}>
                <th scope="row">
                  {/* D-028: the face when there is one, the raw id otherwise. */}
                  {m.displayName ?? m.actorId}
                </th>
                <td data-state={state.kind}>{stateLabel(state.kind)}</td>
                <td>{state.ticketId ?? '—'}</td>
                <td>
                  {m.jobLine ?? '—'}
                  {onSelect && (
                    <button
                      type="button"
                      className="btn-quiet"
                      data-testid={`list-open-${m.actorId}`}
                      onClick={() => onSelect(m.actorId)}
                    >
                      What they did
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
