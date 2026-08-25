/**
 * The Team view (W20-02, UX_SPEC §10) — the office at a glance.
 *
 * Every card's state comes from `deriveMemberState`, the single canonical
 * mapping; this file renders it and never re-derives. D-028's law holds:
 * nothing renders that the ledger cannot back, so a member with no events
 * reads "nothing assigned" rather than something flattering.
 */
import { useMemo } from 'react';
import type { BoardTicket, HeartbeatData } from '../board/types.js';
import { deriveMemberState, type FounderAsk, type MemberState } from './memberState.js';
import { seatMembers } from './seats.js';
import type { TeamMember } from './types.js';
import './team.css';

export interface TeamViewProps {
  readonly members: readonly TeamMember[];
  readonly tickets: readonly BoardTicket[];
  readonly heartbeats: ReadonlyMap<string, HeartbeatData>;
  readonly asks: readonly FounderAsk[];
  readonly onSelect?: (actorId: string) => void;
  /** Opens the decision/approval this member is waiting on. */
  readonly onAnswer?: (actorId: string) => void;
}

export interface MemberWithState {
  readonly member: TeamMember;
  readonly state: MemberState;
}

export function TeamView({
  members,
  tickets,
  heartbeats,
  asks,
  onSelect,
  onAnswer,
}: TeamViewProps) {
  const rows: MemberWithState[] = useMemo(
    () =>
      members.map((member) => ({
        member,
        state: deriveMemberState({
          actorId: member.actorId,
          tickets,
          heartbeats,
          asks,
        }),
      })),
    [members, tickets, heartbeats, asks],
  );

  if (members.length === 0) {
    return (
      <div className="team" data-testid="team-view">
        <p className="team__empty" data-testid="team-empty">
          The roster hasn&rsquo;t loaded — the board view still works.
        </p>
      </div>
    );
  }

  // W20-12: grouped by what people are FOR; what they are doing still comes
  // from the state mapping, never from where they sit.
  const zones = seatMembers(rows.map((r) => ({ ...r, role: r.member.role })));

  return (
    <div className="team" data-testid="team-view">
      {zones.map((zone) => (
        <section key={zone.zone} data-testid={`team-zone-${zone.zone}`}>
          <h3 className="team__zone">{zone.label}</h3>
          <ul className="team__grid">
        {zone.members.map(({ member, state }) => (
          <li key={member.actorId}>
            <article
              className={`surface team__card team__card--${state.kind}`}
              data-testid={`team-member-${member.actorId}`}
              data-state={state.kind}
            >
              <header className="team__who">
                <span className="team__avatar" aria-hidden="true">
                  {member.avatar ?? '•'}
                </span>
                <span>
                  {/* D-028: the face when there is one, the raw id when there is not. */}
                  <b className="team__name">{member.displayName ?? member.actorId}</b>
                  {/* Only when it adds information: an unpersonified member
                      would otherwise echo its own id back as a job line. */}
                  {member.jobLine && <span className="team__job">{member.jobLine}</span>}
                </span>
              </header>
              <p
                className={`state state--${state.kind}`}
                data-testid={`team-state-${member.actorId}`}
              >
                {state.line}
              </p>
              {state.kind === 'blocked-on-you' && onAnswer && (
                <button
                  type="button"
                  className="btn-primary team__answer"
                  data-testid={`team-answer-${member.actorId}`}
                  onClick={() => onAnswer(member.actorId)}
                >
                  Answer {member.displayName ?? member.actorId}
                </button>
              )}
              {onSelect && (
                <button
                  type="button"
                  className="btn-quiet team__open"
                  data-testid={`team-open-${member.actorId}`}
                  onClick={() => onSelect(member.actorId)}
                >
                  What they did
                </button>
              )}
            </article>
          </li>
        ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
