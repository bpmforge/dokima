/**
 * The scene (W21-01) — a PURE function from placed members to what the office
 * draws. This module is the entire input to the canvas renderer, and that is
 * deliberate: a canvas has no assertion surface, so the invariant has to live
 * somewhere a test can reach.
 *
 * Two properties hold by construction:
 *
 *  1. **A figure's pose is the `Pose` union**, which `poseFor` produces from a
 *     member state with no default branch. The renderer therefore cannot draw
 *     a pose that no state maps to — it is a type error, not a review note.
 *  2. **Only `walking-handoff` moves.** Every other figure is placed at a fixed
 *     spot and animates in place, if at all. This is "no idle theater" made
 *     mechanical: nobody crosses the floor unless the ledger says work changed
 *     hands.
 */
import type { PoseSpec, Pose } from './poses.js';
import {
  DIVIDER_X, DIVIDER_W, WALL_H, STAGE_H, YOURS_Y, YOURS_WALL_H,
} from './officeRoom.js';

/** Where a figure stands, and how it is drawn. Canvas coordinates. */
export interface SceneFigure {
  readonly actorId: string;
  readonly pose: Pose;
  readonly place: PoseSpec['place'];
  /** Top-left of the character sprite. */
  readonly x: number;
  readonly y: number;
  /** A desk is drawn behind a seated figure; absent for everyone else. */
  readonly desk?: { readonly x: number; readonly y: number; readonly lit: boolean };
  /** Only true for walking-handoff — the one pose the ledger lets move. */
  readonly moves: boolean;
  /** Per-figure phase so in-place loops do not tick in lockstep. */
  readonly phase: number;
}

/** Character sprite footprint, in stage pixels (16x26 baked at 3x). */
const FIG_W = 48;
const FIG_H = 78;

/**
 * Six desks on the work floor: three across, two rows. Exported because the
 * painter draws ALL of them as furniture — an empty desk is part of the room,
 * not a member. Only the ones with somebody at them light up.
 */
export const DESK_SPOTS: readonly (readonly [number, number])[] = [
  [30, 150], [190, 150], [350, 150],
  [30, 380], [190, 380], [350, 380],
];
/** The seat sits just in front of its desk, so the figure reads as AT it. */
const seatOf = (d: readonly [number, number]): [number, number] => [d[0] + 25, d[1] + 62];

/** Chairs in your office, on the carpet — the waiting room, drawn. */
export const WAITING_CHAIRS: readonly (readonly [number, number])[] = [
  [600, YOURS_Y + YOURS_WALL_H + 26],
  [710, YOURS_Y + YOURS_WALL_H + 26],
  [820, YOURS_Y + YOURS_WALL_H + 26],
];

/**
 * The break room's standing room: a grid across the tile floor, below the
 * cooler and the couch. Twelve spots, because the whole org being idle at once
 * is the ordinary state of a board with nothing running — a layout that only
 * looks right when people are busy is a layout that is usually wrong.
 */
const BREAK_SPOTS: readonly (readonly [number, number])[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
].map((i) => [552 + (i % 6) * 78, 230 + Math.floor(i / 6) * 78] as const);

/** The corridor through the doorway — where a handoff is carried across. */
export const AISLE_Y = 318;
export const AISLE_FROM = DIVIDER_X - 150;
export const AISLE_TO = DIVIDER_X + DIVIDER_W + 60;

/**
 * Wrap an index onto a spot list, stepping down and right when it overflows.
 * Deterministic: the same member list always yields the same floor plan.
 */
function spotAt(
  spots: readonly (readonly [number, number])[], i: number,
): [number, number] {
  const base = spots[i % spots.length]!;
  const lap = Math.floor(i / spots.length);
  return [base[0] + lap * 22, base[1] + lap * 30];
}

export interface PlacedMember {
  readonly actorId: string;
  readonly spec: PoseSpec;
}

/**
 * Lay out the office. Input is exactly what `OfficeSkin` already computed from
 * `deriveMemberState` + `poseFor`; this adds coordinates and nothing else — no
 * state, no filtering, no member the caller did not pass.
 */
export function buildScene(placed: readonly PlacedMember[]): SceneFigure[] {
  const counters: Record<PoseSpec['place'], number> = {
    desk: 0, 'your-office': 0, 'break-room': 0, aisle: 0,
  };
  return placed.map((p, index) => {
    const place = p.spec.place;
    const n = counters[place]++;
    const phase = index * 0.37;
    if (place === 'desk') {
      const deskSpot = spotAt(DESK_SPOTS, n);
      const [sx, sy] = seatOf(deskSpot);
      return {
        actorId: p.actorId, pose: p.spec.pose, place,
        x: sx, y: sy,
        desk: { x: deskSpot[0], y: deskSpot[1], lit: p.spec.pose !== 'sitting-idle' },
        moves: false, phase,
      };
    }
    if (place === 'your-office') {
      const [x, y] = spotAt(WAITING_CHAIRS, n);
      return { actorId: p.actorId, pose: p.spec.pose, place, x, y, moves: false, phase };
    }
    if (place === 'break-room') {
      const [x, y] = spotAt(BREAK_SPOTS, n);
      return { actorId: p.actorId, pose: p.spec.pose, place, x, y, moves: false, phase };
    }
    // The aisle: staggered along the corridor, and the only place that moves.
    return {
      actorId: p.actorId, pose: p.spec.pose, place,
      x: AISLE_FROM + n * 40, y: AISLE_Y,
      moves: true, phase,
    };
  });
}

/**
 * Where a walking figure is at time `t`, in seconds. A slow shuttle along the
 * corridor and back — it depicts "work is being handed over", nothing more.
 * Figures that do not move return their fixed x, so callers need no branch.
 */
export function figureX(fig: SceneFigure, t: number): number {
  if (!fig.moves) return fig.x;
  const span = AISLE_TO - AISLE_FROM;
  const cycle = (t * 26 + fig.phase * 60) % (span * 2);
  return AISLE_FROM + (cycle < span ? cycle : span * 2 - cycle);
}

/** Which way a walking figure faces — mirrored when heading back. */
export function figureFlipped(fig: SceneFigure, t: number): boolean {
  if (!fig.moves) return false;
  const span = AISLE_TO - AISLE_FROM;
  return (t * 26 + fig.phase * 60) % (span * 2) >= span;
}

/** Bounds the scene must stay inside — used to keep hit targets on the stage. */
export const SCENE_BOUNDS = {
  top: WALL_H,
  bottom: STAGE_H - FIG_H,
  figureWidth: FIG_W,
  figureHeight: FIG_H,
} as const;
