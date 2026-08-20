import type { PlanFunnel, PlanItemState } from './types.js';

export const STATE_LABEL: Record<PlanItemState, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  in_progress: 'In progress',
  done: 'Done',
  regressed: 'Regressed',
};

/**
 * AC2's funnel line, FR-RL4 style: every stage shown, the raw count never
 * hidden. W13-50 (UX_AUDIT A-2) reworded it into plain verbs — "raw
 * findings"/"plan items" was internal machinery as a page header. The stages
 * themselves all survive: found → planned → accepted → done · regressed.
 */
export function funnelSummary(funnel: PlanFunnel): string {
  return (
    `${funnel.rawFindings} found → ${funnel.planItems} planned → ` +
    `${funnel.accepted} accepted → ${funnel.done} done · ${funnel.regressed} regressed`
  );
}

/**
 * Scores render only when they can rank (W13-50). A creation-run plan gives
 * every item the same fixed severity/leverage, so the row "severity 3 ·
 * leverage 3 · priority score 9" on every card carried zero information with
 * an authoritative face. A health-scan plan varies — there the numbers are
 * doing their job and they show.
 */
export function scoresVary(items: readonly { severity: number; leverage: number; rank: number }[]): boolean {
  const first = items[0];
  if (items.length < 2 || first === undefined) return false;
  return items.some(
    (i) => i.severity !== first.severity || i.leverage !== first.leverage || i.rank !== first.rank,
  );
}

export function canAccept(state: PlanItemState): boolean {
  return state === 'proposed' || state === 'regressed';
}

export function canDismiss(state: PlanItemState): boolean {
  return state === 'proposed';
}
