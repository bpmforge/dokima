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

/**
 * Plain-language sentence for a catalog verify criterion (W13-59). The
 * Improvement Plan asked a novice to Accept or Dismiss on the strength of a
 * machine expression ('receipts.staleCount == 0') — an undecidable decision.
 * Each shipped catalog expression gets a human sentence; the expression
 * itself stays on the card as secondary detail. An unknown expression falls
 * back to an honest generic framing, never an invented meaning.
 */
const VERIFY_SENTENCE: Record<string, string> = {
  'coverage.requiredSkipped == 0': 'Done when no required coverage topic is being skipped.',
  'deliverables.orphanedCount == 0': 'Done when no deliverable is left orphaned.',
  'findings.openCriticalUnwaived == 0':
    'Done when no critical finding is open without a waiver.',
  'gates.missingRedFixtureCount == 0':
    'Done when every gate has a planted failure proving it can actually fail.',
  'planItems.regressedCount == 0': 'Done when no accepted plan item has slipped back.',
  'playbook.staleEntryCount == 0': 'Done when no playbook entry is stale.',
  'providers.unverifiedTosCount == 0':
    'Done when every model provider’s terms have been verified.',
  'receipts.staleCount == 0':
    'Done when every receipt still matches the work it vouches for.',
  'rules.fpHeavyCount == 0':
    'Done when no rule is mostly raising false alarms.',
  'spend.thresholdBreachRepeatCount == 0':
    'Done when spend stops repeatedly breaking through its threshold.',
  'tickets.blockedWithEvidenceMaxAgeDays <= 3':
    'Done when no ticket has sat blocked with evidence for more than 3 days.',
  'tickets.oscillatingCount == 0':
    'Done when no ticket keeps bouncing back and forth between states.',
};

export function describeVerifyCriterion(expression: string): string {
  return (
    VERIFY_SENTENCE[expression] ??
    'Checked automatically against the project’s live state.'
  );
}
