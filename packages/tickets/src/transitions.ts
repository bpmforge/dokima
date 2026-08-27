import type { TicketStatus } from './types.js';

export type LifecycleVerb =
  'claim' | 'start' | 'close' | 'accept' | 'reject' | 'release' | 'comment';

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
  /**
   * W21-42: the counterpart of `accept`, and the shape a review gate must
   * have. `accept` refuses the owner (maker != verifier, C-4) while `release`
   * from `in_review` REQUIRES the owner — so the verifier identity was
   * permitted to approve and forbidden to send work back, and the only way to
   * reject was to act as the thing being reviewed. Same actor rule as accept,
   * opposite destination.
   */
  reject: { from: ['in_review'], to: 'ready' },
  release: { from: ['claimed', 'in_progress', 'in_review'], to: 'ready' },
};

export function isValidTransition(
  verb: Exclude<LifecycleVerb, 'comment'>,
  from: TicketStatus,
): boolean {
  return (TRANSITIONS[verb].from as readonly TicketStatus[]).includes(from);
}
