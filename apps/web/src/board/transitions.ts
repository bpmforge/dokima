import type { LifecycleVerb } from './api.js';
import type { TicketStatus } from './types.js';

/**
 * Board columns in display order (UX_SPEC §4). Mirrors
 * `packages/tickets/src/transitions.ts` TRANSITIONS graph — apps/web may
 * not import that package (ARCHITECTURE §4 dependency law: apps/web talks
 * REST+WS only), so the same verb → {from, to} graph is hand-duplicated
 * here. This is the ONE place a card's column is decided from a drag
 * target; drag never bypasses a gate (UX_SPEC §4 "no 'just move it' mode")
 * — a drop that doesn't map to a verb here never reaches the network.
 */
export const BOARD_COLUMNS: readonly TicketStatus[] = [
  'ready',
  'claimed',
  'in_progress',
  'in_review',
  'blocked',
  'done',
];

const VERB_TARGET: Record<
  Exclude<LifecycleVerb, 'comment'>,
  { from: readonly TicketStatus[]; to: TicketStatus }
> = {
  claim: { from: ['ready'], to: 'claimed' },
  start: { from: ['claimed'], to: 'in_progress' },
  close: { from: ['in_progress'], to: 'in_review' },
  accept: { from: ['in_review'], to: 'done' },
  release: { from: ['claimed', 'in_progress', 'in_review'], to: 'ready' },
};

/**
 * The verb a drop onto `toColumn` would fire for a card currently at
 * `from`, or `null` if no verb reaches that column from that status (an
 * illegal drop the card animates back from without ever calling the API,
 * per UX_SPEC §4).
 */
export function verbForDrop(
  from: TicketStatus,
  toColumn: TicketStatus,
): LifecycleVerb | null {
  if (from === toColumn) return null;
  for (const [verb, transition] of Object.entries(VERB_TARGET)) {
    if (
      transition.to === toColumn &&
      (transition.from as readonly TicketStatus[]).includes(from)
    ) {
      return verb as LifecycleVerb;
    }
  }
  return null;
}

/**
 * Keyboard/menu equivalent of a drag (WCAG 2.2 AA, UX_SPEC §9
 * "every drag has a verb equivalent"): every verb reachable from a status,
 * card-menu order.
 */
export function availableVerbsFrom(
  status: TicketStatus,
): Exclude<LifecycleVerb, 'comment'>[] {
  return (Object.keys(VERB_TARGET) as Exclude<LifecycleVerb, 'comment'>[]).filter(
    (verb) => (VERB_TARGET[verb].from as readonly TicketStatus[]).includes(status),
  );
}

export function verbTargetColumn(verb: Exclude<LifecycleVerb, 'comment'>): TicketStatus {
  return VERB_TARGET[verb].to;
}
