/**
 * Depth policy (FR-P8/US-105 AC-1, content/experts/phase-specialists/researcher.md's four
 * Research Modes): collapses QUICK LOOKUP / COMPARISON / DEEP DIVE / FACT CHECK onto
 * BLUEPRINT §3.2's 3-depth axis. Source-count floors rise monotonically with depth;
 * `challengerMandatory` is true only for `deep` — researcher.md Step 5.4: "Challenger is
 * mandatory on every DEEP DIVE report", independent of any single claim's impact (a `deep`
 * report's LOW-impact claims still need a verdict, unlike `quick`/`standard`, where only
 * HIGH-impact claims are gated — see `challenger-gate.ts`).
 */

import type { ResearchDepth } from './types.js';

export interface DepthPolicy {
  readonly depth: ResearchDepth;
  readonly minSources: number;
  readonly challengerMandatory: boolean;
}

const POLICIES: Readonly<Record<ResearchDepth, DepthPolicy>> = {
  quick: { depth: 'quick', minSources: 1, challengerMandatory: false },
  standard: { depth: 'standard', minSources: 2, challengerMandatory: false },
  deep: { depth: 'deep', minSources: 3, challengerMandatory: true },
};

export function getDepthPolicy(depth: ResearchDepth): DepthPolicy {
  return POLICIES[depth];
}
