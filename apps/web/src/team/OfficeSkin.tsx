/**
 * Office mode (W20-08) — a strict skin over the Team board's store.
 *
 * It re-renders `deriveMemberState`'s output through `poseFor` and holds no
 * data of its own: switching modes changes zero facts. Every character on
 * screen is drawn in a pose that maps 1:1 to a named state, and each carries
 * the reason it is in that pose — so the office can explain itself without
 * inventing a narrative (D-028's "no idle theater").
 *
 * The art here is deliberately simple: CSS rooms and emoji figures. The 32-bit
 * sprite sheet from the W20 mockup is asset work (licensed pack or commissioned
 * originals) and is tracked separately — shipping placeholder art that renders
 * true states beats shipping beautiful art that renders invented ones.
 */
import { deriveMemberState, type FounderAsk } from './memberState.js';
import { poseFor, type PoseSpec } from './poses.js';
import type { BoardTicket, HeartbeatData } from '../board/types.js';
import type { TeamMember } from './types.js';

const PLACE_LABEL: Record<PoseSpec['place'], string> = {
  desk: 'At their desks',
  'your-office': 'Your office',
  'break-room': 'Break room',
  aisle: 'Handing work over',
};

const PLACE_ORDER: PoseSpec['place'][] = ['your-office', 'desk', 'aisle', 'break-room'];

export interface OfficeSkinProps {
  readonly members: readonly TeamMember[];
  readonly tickets: readonly BoardTicket[];
  readonly heartbeats: ReadonlyMap<string, HeartbeatData>;
  readonly asks: readonly FounderAsk[];
  readonly onSelect?: (actorId: string) => void;
}

export function OfficeSkin({
  members,
  tickets,
  heartbeats,
  asks,
  onSelect,
}: OfficeSkinProps) {
  const placed = members.map((member) => {
    const state = deriveMemberState({
      actorId: member.actorId,
      tickets,
      heartbeats,
      asks,
    });
    return { member, state, spec: poseFor(state.kind) };
  });

  return (
    <div className="office" data-testid="office-skin">
      {PLACE_ORDER.filter((place) => placed.some((p) => p.spec.place === place)).map(
        (place) => (
          <section
            key={place}
            className={`surface office__room office__room--${place}`}
            data-testid={`office-room-${place}`}
          >
            <h3 className="office__room-title">{PLACE_LABEL[place]}</h3>
            <ul className="office__figures">
              {placed
                .filter((p) => p.spec.place === place)
                .map(({ member, state, spec }) => (
                  <li key={member.actorId}>
                    <button
                      type="button"
                      className={`office__figure office__figure--${spec.pose}`}
                      data-testid={`office-figure-${member.actorId}`}
                      data-pose={spec.pose}
                      data-state={state.kind}
                      onClick={() => onSelect?.(member.actorId)}
                      // The pose's reason IS the tooltip — never a flourish.
                      title={`${state.line} — ${spec.because}`}
                    >
                      <span className="office__avatar" aria-hidden="true">
                        {member.avatar ?? '•'}
                      </span>
                      <span className="office__name">
                        {member.displayName ?? member.actorId}
                      </span>
                      <span className="office__state">{state.line}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ),
      )}
      <p className="office__legend" data-testid="office-legend">
        Every pose here is a ledger event. Nobody moves without evidence.
      </p>
    </div>
  );
}
