/**
 * R0 fact bank admission — FR-P8/US-105 AC-3: "confirmed findings enter the R0 fact bank."
 * Admits a claim (building the `FactBankEntry` a future `appendFact` seam would insert
 * unchanged, see `types.ts`) only when its citations validate AND, for HIGH-impact claims, a
 * CONFIRMED Challenger verdict exists. Never throws — an inadmissible claim is a normal
 * outcome, not an error.
 */

import { validateClaimCitations } from './citations.js';
import { decideClaimCitability } from './challenger-gate.js';
import type {
  ClaimVerdict,
  FactBankEntry,
  PhaseId,
  ResearchClaim,
  ResearchSource,
  SourceTier,
} from './types.js';

const TIER_CONFIDENCE: Readonly<Record<SourceTier, number>> = {
  1: 0.9,
  2: 0.75,
  3: 0.5,
  4: 0.3,
};

function bestConfidence(
  claim: ResearchClaim,
  sources: readonly ResearchSource[],
): number {
  const byId = new Map(sources.map((source) => [source.id, source]));
  let best = 0;
  for (const sourceId of claim.citedSourceIds) {
    const source = byId.get(sourceId);
    if (source) best = Math.max(best, TIER_CONFIDENCE[source.tier]);
  }
  return best;
}

export interface FactBankContext {
  readonly phase: PhaseId | null;
  readonly createdAt: string;
  /** Used to build a stable, per-report-unique `FactBankEntry.id`. */
  readonly idPrefix: string;
}

/** RED FIXTURE case: an uncited or unchallenged HIGH claim must never produce an entry. */
export function decideFactBankAdmission(
  claim: ResearchClaim,
  sources: readonly ResearchSource[],
  verdict: ClaimVerdict | null,
  context: FactBankContext,
): FactBankEntry | null {
  if (!validateClaimCitations(claim, sources).valid) return null;
  if (!decideClaimCitability(claim, verdict).valid) return null;

  const citedSources = sources.filter((source) =>
    claim.citedSourceIds.includes(source.id),
  );

  return {
    id: `${context.idPrefix}-${claim.id}`,
    kind: 'research',
    content: claim.text,
    source: citedSources.map((source) => source.url).join('; '),
    confidence: bestConfidence(claim, sources),
    verified: true,
    ticketId: null,
    phase: context.phase,
    createdAt: context.createdAt,
    lastUsedAt: null,
    useCount: 0,
    decayed: false,
  };
}
