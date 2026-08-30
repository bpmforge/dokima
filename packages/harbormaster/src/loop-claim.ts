/**
 * loop-claim.ts — the abandoned-claim sweep, and the tombstone of a loop that
 * was never on a live path.
 *
 * WHAT WAS HERE. `runClaimLoop` was F1's claim engine (BLUEPRINT §3.6): claim
 * the lowest-id claimable ticket, give it a worktree, dispatch sessions,
 * auto-block with evidence when the cap ran out. It was real, it was tested,
 * and `apps/*` never called it — `runLandLoop` is the only wired execution
 * engine, and had been for months. Its own docstring said so.
 *
 * DELETED 2026-08-30 by founder decision (W21-36); reasoning in
 * docs/ARCHITECTURE.md. Documented-dead code is worse than either live code
 * or absent code, because it passes every mechanical check a live path passes
 * and nothing distinguishes the two except a comment somebody has to happen
 * to read. That is not hypothetical here: W21-12 put worktree provisioning
 * into this file, the full gate went green because these tests exercised it,
 * and a live run then proved the code had never executed.
 *
 * WHAT SURVIVES, AND WHY THE FILE DID NOT GO WITH THE FUNCTION. The
 * abandoned-claim sweep below is LIVE — `loop-land-reclaim.ts` imports both
 * symbols and `loop-land.ts` calls it at every idle turn — and
 * `DEFAULT_MAX_SESSIONS_PER_TICKET` is the land ladder's own ceiling. Deleting
 * the file would have deleted the sweep that W21-36's acceptance required to
 * survive the deletion.
 */
import type { Ticket } from '@dokima/tickets';

/**
 * The land ladder's default attempt ceiling per ticket.
 *
 * Named for the claim loop that no longer exists and kept under that name
 * deliberately: `loop-land-ticket.ts` reads it, and renaming a number that
 * appears in park evidence and in tests would be a second change wearing the
 * clothes of this one.
 */
export const DEFAULT_MAX_SESSIONS_PER_TICKET = 2;

/**
 * How long a ticket may show NO activity before its claim is treated as
 * abandoned (W13-12).
 *
 * Derived from the longest silence a healthy session can legitimately produce,
 * not picked round: one `verify` (10 minutes, DEFAULT_VERIFY_TIMEOUT_MS) plus
 * one model call (5 minutes on a local endpoint, RUN_LIMITS.md) is about
 * fifteen, so thirty gives a full factor of two before anything is reclaimed.
 * Reaping a live session would be far worse than reclaiming a dead one late.
 */
export const STALE_CLAIM_MS = 30 * 60 * 1000;

/**
 * Tickets held by an owner that is gone (W13-12).
 *
 * THE EVENT LOG IS THE HEARTBEAT, which is why this needs no new bookkeeping:
 * a live session emits an `mcp.tool_call.completed` per tool call, so any
 * ticket with recent events is being worked on by definition. `claimedAt`
 * alone could not do this — a legitimately long session looks identical to an
 * abandoned one by that measure.
 *
 * Found in live testing: a run killed at an external timeout, and later a run
 * crashed by an uncaught provider timeout (W13-13), each left a ticket in
 * `in_progress` with its owner gone. The next run reported "0 landed, 0
 * parked" in zero seconds and explained nothing.
 */
export function findAbandonedTickets(
  tickets: readonly Ticket[],
  events: readonly { ticketId: string | null; createdAt: string }[],
  nowIso: string,
  staleMs: number = STALE_CLAIM_MS,
): Ticket[] {
  const lastSeen = new Map<string, number>();
  for (const event of events) {
    if (!event.ticketId) continue;
    const at = Date.parse(event.createdAt);
    if (Number.isNaN(at)) continue;
    const prev = lastSeen.get(event.ticketId);
    if (prev === undefined || at > prev) lastSeen.set(event.ticketId, at);
  }
  const now = Date.parse(nowIso);
  return tickets.filter((ticket) => {
    if (ticket.status !== 'claimed' && ticket.status !== 'in_progress') return false;
    const seen = lastSeen.get(ticket.id);
    // No events at all for a held ticket cannot happen (claiming emits one),
    // so treat it as abandoned rather than immortal.
    return seen === undefined || now - seen > staleMs;
  });
}
