/**
 * Otto's funnel — the one queue to the founder (W20-09, D-030).
 *
 * OPERATIONS.md names exactly five classes that may reach the manager. This
 * module is that rule, executable: a pure function from open items to an
 * ordered queue. It has three properties the trust model depends on, and all
 * three are structural rather than promised:
 *
 *  1. **It cannot drop an item.** `orderFounderQueue` is a total sort — every
 *     input appears in the output. There is no filter parameter, no cap, and
 *     no "hidden" flag, so suppression is not a capability anyone can misuse.
 *     Depth is therefore always the true open count.
 *  2. **It cannot answer.** Nothing here resolves, decides, or mutates. The
 *     caller renders; the founder answers through the existing verbs.
 *  3. **It cannot rank by opinion.** The sort key is computed from the DAG and
 *     the clock — no model call, no heuristic text scoring. A model deciding
 *     WHAT THE FOUNDER SEES is the same trust hole as a model grading its own
 *     work (C-2), and the fix is to remove the capability, not to police it.
 *
 * The order (D-030): blocks the whole run > count of blocked dependents >
 * oldest > cheapest to answer. `reason` carries the mechanical explanation so
 * the surface can say *why* an item is first without inventing a narrative.
 */

/** The five classes OPERATIONS.md allows through. Anything else is a bug. */
export type FounderItemClass =
  | 'founder-decision'
  | 'approval'
  | 'blocked-on-you'
  | 'acceptance'
  | 'interview'
  /**
   * W21-26: a ticket that has been claimed, worked and released repeatedly
   * without ever reaching review. The loop has no exit of its own — each park
   * returns the ticket to Ready and the next run repeats it, so a ticket whose
   * scope cannot satisfy its acceptance is retried forever and nobody is told.
   * Observed on a real project: seven consecutive parks, the last two spending
   * 36 and 40 turns each on work that could never close.
   *
   * This belongs in the "blocked on you" family of OPERATIONS.md — the run
   * cannot proceed without a person changing something — but it is named
   * distinctly because the decision is different: not "answer a question" but
   * "this ticket may be wrong as written".
   */
  | 'stuck-ticket';

export const FOUNDER_ITEM_CLASSES: readonly FounderItemClass[] = [
  'founder-decision',
  'approval',
  'blocked-on-you',
  'acceptance',
  'interview',
  'stuck-ticket',
];

/**
 * How many claim-and-release cycles before a ticket is treated as stuck.
 *
 * Two is deliberate and matches the ladder cap: one park is a bad attempt, two
 * is a pattern, and the product already gives up on its own at that point —
 * it just used to give up silently.
 */
export const STUCK_CLAIM_THRESHOLD = 2;

/**
 * Whether a ticket keeps being picked up and put back down without ever
 * reaching review. Counted from the ledgered verbs — never from a model's
 * account of what happened (C-2). `close` is the verb that moves a ticket to
 * review, so a ticket that has ever closed is making progress by definition.
 */
export function isStuckTicket(
  ticket: {
    readonly status: string;
    readonly history: readonly { readonly verb: string }[];
  },
  threshold = STUCK_CLAIM_THRESHOLD,
): boolean {
  if (ticket.status !== 'ready') return false;
  if (ticket.history.some((h) => h.verb === 'close' || h.verb === 'accept')) return false;
  const releases = ticket.history.filter((h) => h.verb === 'release').length;
  return releases >= threshold;
}

export interface FounderQueueItem {
  readonly id: string;
  readonly kind: FounderItemClass;
  /** The member this is attributable to — the waiting room seats them (W20-10). */
  readonly actorId: string;
  readonly title: string;
  /** The ticket at stake, when there is one. */
  readonly ticketId: string | null;
  /** ISO timestamp the item opened. */
  readonly openedAt: string;
  /** Money this answer commits, when known — the tie-break, never the lead. */
  readonly estimatedCostUsd: number | null;
  /** True when nothing else in the run can proceed until this is answered. */
  readonly blocksRun: boolean;
  /** Tickets blocked (directly or transitively) on this item's ticket. */
  readonly blockedDependents: number;
}

export interface OrderedFounderItem extends FounderQueueItem {
  /** 1-based position; also the waiting-room seat index (W20-10). */
  readonly position: number;
  /** Why it sits here, in mechanical words — never a model's narrative. */
  readonly reason: string;
}

function reasonFor(item: FounderQueueItem): string {
  if (item.kind === 'stuck-ticket') {
    return 'picked up and put back down repeatedly without ever reaching review';
  }
  if (item.blocksRun) return 'blocks the whole run';
  if (item.blockedDependents > 0) {
    return `blocks ${item.blockedDependents} ticket${item.blockedDependents === 1 ? '' : 's'}`;
  }
  return 'nothing else is waiting on it';
}

/**
 * Total order over the open items. Every input appears exactly once in the
 * output — the type makes that the only possible outcome, which is what makes
 * "Otto cannot drop an item" a property rather than a policy.
 */
export function orderFounderQueue(
  items: readonly FounderQueueItem[],
): OrderedFounderItem[] {
  const sorted = [...items].sort((a, b) => {
    // 1. blocks the whole run
    if (a.blocksRun !== b.blocksRun) return a.blocksRun ? -1 : 1;
    // 2. unblocks the most work
    if (a.blockedDependents !== b.blockedDependents) {
      return b.blockedDependents - a.blockedDependents;
    }
    // 3. oldest first
    if (a.openedAt !== b.openedAt) return a.openedAt < b.openedAt ? -1 : 1;
    // 4. cheapest to answer last (a free choice is quicker to clear than a spend)
    const ac = a.estimatedCostUsd ?? 0;
    const bc = b.estimatedCostUsd ?? 0;
    if (ac !== bc) return ac - bc;
    // stable, deterministic tail — never insertion order, which varies by store
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.map((item, i) => ({
    ...item,
    position: i + 1,
    reason: reasonFor(item),
  }));
}

/**
 * How many tickets are blocked (directly or transitively) on `ticketId`.
 * Pure graph arithmetic over `depends_on` — the "unblocks the most work"
 * signal, computed rather than judged.
 */
export function countBlockedDependents(
  ticketId: string | null,
  tickets: readonly { readonly id: string; readonly dependsOn: readonly string[] }[],
): number {
  if (!ticketId) return 0;
  const dependents = new Map<string, string[]>();
  for (const t of tickets) {
    for (const dep of t.dependsOn) {
      const list = dependents.get(dep);
      if (list) list.push(t.id);
      else dependents.set(dep, [t.id]);
    }
  }
  const seen = new Set<string>();
  const stack = [ticketId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of dependents.get(current) ?? []) {
      if (seen.has(next)) continue; // also the cycle guard
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size;
}
