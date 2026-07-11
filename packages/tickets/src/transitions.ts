import type { TicketStatus } from './types.js';

export type LifecycleVerb =
  'claim' | 'start' | 'close' | 'accept' | 'release' | 'comment';

/**
 * The enforced transition graph (BLUEPRINT §3.4):
 * `ready -claim-> claimed -start-> in_progress -close-> in_review -accept-> done`
 * plus `release` (back to `ready` from any owned state) and `comment` (no
 * status change, any state). This is the ONLY place status transitions are
 * defined — verbs consult it, nothing writes `status` directly.
 */
export const TRANSITIONS: Record<
  Exclude<LifecycleVerb, 'comment'>,
  {
    from: readonly TicketStatus[];
    to: TicketStatus;
  }
> = {
  claim: { from: ['ready'], to: 'claimed' },
  start: { from: ['claimed'], to: 'in_progress' },
  close: { from: ['in_progress'], to: 'in_review' },
  accept: { from: ['in_review'], to: 'done' },
  release: { from: ['claimed', 'in_progress', 'in_review'], to: 'ready' },
};

export function isValidTransition(
  verb: Exclude<LifecycleVerb, 'comment'>,
  from: TicketStatus,
): boolean {
  return (TRANSITIONS[verb].from as readonly TicketStatus[]).includes(from);
}
