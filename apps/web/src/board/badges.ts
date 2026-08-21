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

/**
 * The blockers a blocked ticket is still waiting on (W13-60). Blocked has
 * no exit verb ON PURPOSE — reflow auto-resolves blocked⇄ready the moment
 * every dependency is done (packages/tickets reflow, FR-T3) — but the card
 * announced the state without saying so, so the novice-journey audit found
 * a dead end: no Move menu, every drag animates back, nothing explains how
 * a ticket ever leaves Blocked. A dangling dependency id counts as open
 * (absence never satisfies), matching `depsDone`.
 */
export function openBlockers(
  ticket: BoardTicket,
  all: readonly BoardTicket[],
): string[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  return ticket.dependsOn.filter((depId) => byId.get(depId)?.status !== 'done');
}

/**
 * The on-card sentence that turns Blocked from a dead end into a wait the
 * novice understands: what it waits on, and that opening is automatic —
 * there is nothing to click and nothing being asked of them.
 */
export function blockedExplanation(blockers: readonly string[]): string {
  if (blockers.length === 0) {
    return 'Blocked — waiting on work that must finish first. It moves back to Ready on its own.';
  }
  const named = blockers.join(', ');
  const plural = blockers.length > 1;
  return `Blocked on ${named} — opens on its own when ${plural ? 'they are' : 'it is'} done. Nothing to do here.`;
}

/**
 * W17-07: the park worn on the card face — how many times this run of
 * parks happened and the one-line why, so the evidence is a glance, not an
 * archaeology dig through comments. Returns null for a non-parked ticket.
 */
export function parkSummary(ticket: {
  status: string;
  history: readonly { verb: string; body?: string }[];
}): { count: number; reason: string } | null {
  if (!isParked(ticket)) return null;
  let count = 0;
  let reason = '';
  for (const entry of ticket.history) {
    if (entry.verb !== 'comment') continue;
    const body = entry.body ?? '';
    if (!PARK_MARKERS.some((marker) => body.startsWith(marker))) continue;
    count += 1;
    // The second line carries the first attempt's evidence; the first line
    // is the generic park header. Prefer the most recent park's evidence.
    const lines = body.split('\n');
    reason = (lines[1] ?? lines[0] ?? '').trim();
  }
  if (count === 0) return null;
  // Compress the evidence line to a face-sized sentence.
  reason = reason.replace(/^attempt \d+\/\d+:\s*/, '').slice(0, 140);
  return { count, reason };
}

/**
 * W17-10: a BUDGET park carries its own fix ("raise maxToolIterations") —
 * this turns that sentence into an offer. Only budget parks qualify: a
 * generic retry would hide other failure classes behind one button.
 * Suggests the next budget from the evidence's own number, clamped to the
 * server's hard cap (40).
 */
export const MAX_TOOL_ITERATIONS_CEILING = 40;

export function budgetParkRetry(ticket: {
  status: string;
  history: readonly { verb: string; body?: string }[];
}): { suggested: number } | null {
  const park = parkSummary(ticket);
  if (!park || !park.reason.includes('tool-iteration budget')) return null;
  const match = /budget \((\d+)/.exec(park.reason);
  const current = match ? Number(match[1]) : 12;
  const suggested = Math.min(current + 8, MAX_TOOL_ITERATIONS_CEILING);
  if (suggested <= current) return null;
  return { suggested };
}
