/**
 * The pixel office, as a MAPPING (W20-08, D-028).
 *
 * The office is a skin and nothing more: it renders the states the Team board
 * already derived, from the same store, with no data of its own. This module is
 * the whole contract between them — one pose per state, total by construction.
 *
 * The law it enforces is "no idle theater": every animation must map 1:1 to a
 * named state, so a character can never be shown doing something the ledger
 * did not record. `poseFor` has no default branch, and its test enumerates
 * ALL_MEMBER_STATES — adding a state without a pose fails there rather than
 * silently rendering a member as idle.
 */
import type { MemberStateKind } from './memberState.js';

/** Sprite poses the office can draw. One per state; none spare. */
export type Pose =
  | 'sitting-typing'
  | 'sitting-reading'
  | 'sitting-checking'
  | 'standing-waiting'
  | 'walking-handoff'
  | 'sitting-idle'
  | 'celebrating';

export interface PoseSpec {
  readonly pose: Pose;
  /** Where the office draws them — the waiting room is your office (W20-10). */
  readonly place: 'desk' | 'your-office' | 'break-room' | 'aisle';
  /** The one-line reason this pose is on screen, for the office's own legend. */
  readonly because: string;
}

const POSES: Record<MemberStateKind, PoseSpec> = {
  'blocked-on-you': {
    pose: 'standing-waiting',
    place: 'your-office',
    because: 'an open decision that only you can answer',
  },
  working: {
    pose: 'sitting-typing',
    place: 'desk',
    because: 'a live session turn',
  },
  reading: {
    pose: 'sitting-reading',
    place: 'desk',
    because: 'read-only tool calls',
  },
  'self-checking': {
    pose: 'sitting-checking',
    place: 'desk',
    because: 'the maker running their own checks before handing in',
  },
  'in-review': {
    pose: 'sitting-checking',
    place: 'desk',
    because: 'a reviewer grading someone else’s work',
  },
  submitted: {
    pose: 'walking-handoff',
    place: 'aisle',
    because: 'work handed to a different member',
  },
  assigned: {
    // At their own desk with the screen dark: the desk is occupied, but
    // nothing is running on it. Different from the break room, where nothing
    // is assigned at all (W21-02).
    pose: 'sitting-idle',
    place: 'desk',
    because: 'a ticket claimed, with no live session on it',
  },
  shipped: {
    pose: 'celebrating',
    place: 'desk',
    because: 'a closed ticket with its receipt',
  },
  idle: {
    pose: 'sitting-idle',
    place: 'break-room',
    because: 'no events in the live window',
  },
};

export function poseFor(kind: MemberStateKind): PoseSpec {
  return POSES[kind];
}

/**
 * Every pose the office may draw. The office renderer must not invent one
 * outside this set — that is what makes "no idle theater" checkable rather
 * than merely promised.
 */
export const ALL_POSES: readonly Pose[] = [
  'sitting-typing',
  'sitting-reading',
  'sitting-checking',
  'standing-waiting',
  'walking-handoff',
  'sitting-idle',
  'celebrating',
];
