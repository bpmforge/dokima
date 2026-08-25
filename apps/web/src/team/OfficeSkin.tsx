/**
 * Office mode (W20-08, repainted in W21-01) — a strict skin over the Team
 * board's store.
 *
 * It re-renders `deriveMemberState`'s output through `poseFor` and holds no
 * data of its own: switching modes changes zero facts. Every character on
 * screen is drawn in a pose that maps 1:1 to a named state, and each carries
 * the reason it is in that pose — so the office can explain itself without
 * inventing a narrative (D-028's "no idle theater").
 *
 * The art is a canvas (W21-01): a 32-bit room generated in code, no asset pack
 * to license or load. The canvas is `aria-hidden` background paint. The real
 * office is the DOM layer over it — one button per member, positioned at that
 * member's spot in the scene, carrying `data-pose` and `data-state`. That is
 * what keyboard users, screen readers and every test see, and it is why the
 * renderer could be replaced without weakening a single assertion.
 */
import { deriveMemberState, type FounderAsk } from './memberState.js';
import { OfficeCanvas } from './OfficeCanvas.js';
import { partitionOrg, othersSummary } from './partition.js';
import { poseFor, type PoseSpec } from './poses.js';
import { buildScene, SCENE_BOUNDS } from './scene.js';
import { STAGE_H, STAGE_W } from './officeRoom.js';
import type { BoardTicket, HeartbeatData } from '../board/types.js';
import type { TeamMember } from './types.js';

const PLACE_LABEL: Record<PoseSpec['place'], string> = {
  desk: 'At their desks',
  'your-office': 'Your office',
  'break-room': 'Break room',
  aisle: 'Handing work over',
};

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
  // W20-14: draw the org; the rest are summarised below the room.
  const split = partitionOrg(members);
  const placed = split.org.map((member) => {
    const state = deriveMemberState({
      actorId: member.actorId,
      tickets,
      heartbeats,
      asks,
    });
    return { member, state, spec: poseFor(state.kind) };
  });

  const scene = buildScene(
    placed.map((p) => ({ actorId: p.member.actorId, spec: p.spec })),
  );
  const spotOf = new Map(scene.map((f) => [f.actorId, f]));

  return (
    <div className="office" data-testid="office-skin">
      <div
        className="surface office__scene"
        style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
      >
        <OfficeCanvas figures={scene} />
        {/* The office as the DOM knows it: one hit target per member, sitting
            exactly where the painter drew them. Percentages, so the stage can
            scale to any width without the targets drifting off their bodies. */}
        <ul className="office__figures">
          {placed.map(({ member, state, spec }) => {
            const spot = spotOf.get(member.actorId);
            if (!spot) return null;
            return (
              <li
                key={member.actorId}
                className="office__slot"
                style={{
                  left: `${(spot.x / STAGE_W) * 100}%`,
                  top: `${(spot.y / STAGE_H) * 100}%`,
                  width: `${(SCENE_BOUNDS.figureWidth / STAGE_W) * 100}%`,
                  height: `${(SCENE_BOUNDS.figureHeight / STAGE_H) * 100}%`,
                }}
              >
                <button
                  type="button"
                  className={`office__figure office__figure--${spec.pose}`}
                  data-testid={`office-figure-${member.actorId}`}
                  data-pose={spec.pose}
                  data-state={state.kind}
                  data-place={spec.place}
                  onClick={() => onSelect?.(member.actorId)}
                  // The pose's reason IS the tooltip — never a flourish.
                  title={`${state.line} — ${spec.because}`}
                >
                  <span className="office__name">
                    {member.displayName ?? member.actorId}
                  </span>
                  <span className="sr-only">
                    {PLACE_LABEL[spec.place]}: {state.line}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {split.others.length > 0 && (
        <p className="office__legend" data-testid="office-others">
          {othersSummary(split.others.length)}
        </p>
      )}
      <p className="office__legend" data-testid="office-legend">
        Every pose here is a ledger event. Nobody moves without evidence.
      </p>
    </div>
  );
}
