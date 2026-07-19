import type { PlanFunnel, PlanItemState } from './types.js';

export const STATE_LABEL: Record<PlanItemState, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  in_progress: 'In progress',
  done: 'Done',
  regressed: 'Regressed',
};

/** AC2's funnel line: "raw findings -> plan items -> accepted -> done/regressed", FR-RL4 style (every stage shown, raw never hidden). */
export function funnelSummary(funnel: PlanFunnel): string {
  return `${funnel.rawFindings} raw → ${funnel.planItems} plan items → ${funnel.accepted} accepted → ${funnel.done} done / ${funnel.regressed} regressed`;
}

export function canAccept(state: PlanItemState): boolean {
  return state === 'proposed' || state === 'regressed';
}

export function canDismiss(state: PlanItemState): boolean {
  return state === 'proposed';
}
