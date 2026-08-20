import type { BoardTicket } from './types.js';

/**
 * `STALE — claimable?` (UX_SPEC §4): informational only. Reflow
 * auto-resolves blocked⇄ready by construction (W0-04), so this badge marks
 * a *stored* `blocked` status the next event cycle will clear on its own —
 * or a hand-imported plan needing an explicit `release` (design-review
 * G-10g). The board never offers a control that "fixes" it directly.
 */
export const STALE_BADGE_LABEL = 'STALE — claimable?';

export function isStaleBlocked(ticket: BoardTicket): boolean {
  return ticket.status === 'blocked' && ticket.staleBlocked;
}

/** ⚠ waived-item badge (permanently visible in coverage history, NFR-6). */
export const WAIVED_BADGE_LABEL = '⚠ waived';

export function isWaived(ticket: BoardTicket): boolean {
  return ticket.status === 'waived';
}

/**
 * State carried in FORM (W13-52, VISUAL_DIRECTION's core rule): a card that
 * needs a person is a different shape, not the same shape in a different
 * column. UX_AUDIT A-4 measured the gap — a Blocked card and a Ready card
 * were pixel-identical.
 *
 * blocked -> warning stripe (stuck, not wrong); in_review -> attention
 * stripe (a person is needed to accept someone else's work — C-4 makes that
 * always-human). Everything else is the quiet default: the norm is silence.
 */
export function cardStateClass(status: string): string {
  if (status === 'blocked') return ' surface--blocked';
  if (status === 'in_review') return ' surface--attention';
  return '';
}

export const PARKED_BADGE_LABEL = 'Parked last run — evidence in comments';

/** Markers a park comment has carried; the old header survives in existing logs. */
const PARK_MARKERS = ['Parked with evidence', 'auto-blocked with evidence'];

/**
 * A ticket the last run gave up on (W13-63). The park path deliberately
 * releases to Ready (blocked has no exit verb; the next run retries), so the
 * STATUS carries no trace — a novice watched a run "finish" and saw nothing
 * happen. The evidence is in the ticket history: a park comment with nothing
 * but the release after it.
 */
export function isParked(ticket: {
  status: string;
  history: readonly { verb: string; body?: string }[];
}): boolean {
  if (ticket.status !== 'ready') return false;
  for (let i = ticket.history.length - 1; i >= 0; i -= 1) {
    const entry = ticket.history[i]!;
    if (entry.verb === 'release') continue;
    if (entry.verb === 'comment') {
      return PARK_MARKERS.some((marker) => (entry.body ?? '').startsWith(marker));
    }
    // Any real lifecycle verb after the park means work resumed.
    return false;
  }
  return false;
}
