/**
 * Prune failed-attempt turns + stale tool results (R-I1/R-I2, BLUEPRINT
 * §7.2 items 2/5). Distill-never-replay means raw turn history doesn't
 * belong in a packet at all — anything worth keeping should already be a
 * fact/playbook entry re-entering via `store/retrieval.ts#assembleContext`.
 * This module only guards against a caller that hands in prior-turn
 * records anyway (e.g. same-ticket revise passes within FR-L1's micro-loop)
 * replaying a failed attempt's full content, or a stale tool result,
 * verbatim.
 */

export interface PriorTurn {
  readonly outcome: 'failed' | 'partial' | 'success';
  /** A tool-result turn that is no longer current (superseded by a fresher read). */
  readonly stale?: boolean;
  readonly summary: string;
}

function pruneMarker(reason: string): string {
  return `[pruned: ${reason}]`;
}

/**
 * Drops failed-attempt turns entirely and replaces stale (non-failed) tool
 * results with a fixed `[pruned: ...]` marker; successful, non-stale turns
 * pass through verbatim.
 */
export function pruneTurns(turns: readonly PriorTurn[]): readonly string[] {
  return turns
    .filter((turn) => turn.outcome !== 'failed')
    .map((turn) => (turn.stale ? pruneMarker('stale tool result') : turn.summary));
}
