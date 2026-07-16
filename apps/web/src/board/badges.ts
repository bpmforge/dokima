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
