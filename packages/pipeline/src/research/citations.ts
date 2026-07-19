/**
 * Citation validation (FR-P8: "a research report without citations fails its validator";
 * researcher.md's tiered-source corroboration rule): every claim needs at least one citation
 * resolving to a real source in the report, and a claim rooted only in tier-3/4 sources needs
 * a tier-1/2 corroborator before it counts as established fact.
 */

import type { CheckResult, ResearchClaim, ResearchSource } from './types.js';

function sourcesById(sources: readonly ResearchSource[]): Map<string, ResearchSource> {
  return new Map(sources.map((source) => [source.id, source]));
}

/** RED FIXTURE case: a claim with zero citations must fail — never silently pass. */
export function validateClaimCitations(
  claim: ResearchClaim,
  sources: readonly ResearchSource[],
): CheckResult {
  const reasons: string[] = [];

  if (claim.citedSourceIds.length === 0) {
    return {
      valid: false,
      reasons: [
        `claim "${claim.id}" has no citations — a research report without citations fails its validator (FR-P8)`,
      ],
    };
  }

  const byId = sourcesById(sources);
  const resolved: ResearchSource[] = [];
  for (const sourceId of claim.citedSourceIds) {
    const source = byId.get(sourceId);
    if (!source) {
      reasons.push(`claim "${claim.id}" cites unknown source id "${sourceId}"`);
      continue;
    }
    resolved.push(source);
  }

  if (resolved.length === 0) {
    return { valid: false, reasons };
  }

  const hasTier1or2 = resolved.some((source) => source.tier === 1 || source.tier === 2);
  if (!hasTier1or2) {
    reasons.push(
      `claim "${claim.id}" is rooted only in tier-3/4 sources — needs a tier-1/2 corroborator ` +
        'before counting as established fact (researcher.md corroboration rule)',
    );
  }

  return { valid: reasons.length === 0, reasons };
}

export function validateReportCitations(
  claims: readonly ResearchClaim[],
  sources: readonly ResearchSource[],
): CheckResult {
  const reasons: string[] = [];
  for (const claim of claims) {
    reasons.push(...validateClaimCitations(claim, sources).reasons);
  }
  return { valid: reasons.length === 0, reasons };
}
