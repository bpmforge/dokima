/**
 * Local port types for the research path (BLUEPRINT §3.2/§3.8, FR-P8, US-105).
 *
 * `ClaimVerdict`/`ClaimVerdictResult` are imported directly from `../challenger/` — that
 * module lives in this same package (`@dokima/pipeline`), so no workspace-dependency
 * wall applies (unlike the `@dokima/events`/`@dokima/loop` primitives `../phases/
 * types.ts` and `../challenger/rerun.ts` had to mirror locally). This is the actual
 * "challenger wiring" FR-P8 asks for: a research claim's Challenger outcome is the real
 * W5-06 `ClaimVerdictResult`, not a duplicated shape.
 *
 * `PhaseId` is likewise imported from `../phases/types.ts` (same package) so a research
 * report's phase always lines up with the six-phase topology `../phases/topology.ts`
 * defines — no parallel phase-number type to drift out of sync.
 *
 * `FactBankEntry` mirrors `docs/DATABASE.md` §5's `facts` table row field-for-field
 * (`kind='research'`, `verified` narrowed to `true` since `fact-bank.ts` only ever admits
 * already-Challenger-or-citation-confirmed claims — an inadmissible claim never becomes an
 * entry at all, see `fact-bank.ts`). Persistence (the real `INSERT INTO facts`) is left to
 * the future harbormaster/apps-server wiring ticket, exactly as `../phases/types.ts`'s
 * `RevisionHandoff` leaves `renderHandoff` unbound — this module builds the row unchanged.
 */

import type { ClaimVerdict } from '../challenger/index.js';
import type { PhaseId } from '../phases/types.js';

export type { ClaimVerdict, PhaseId };

/** researcher.md's Research Modes collapsed onto BLUEPRINT §3.2's 3-depth axis. */
export type ResearchDepth = 'quick' | 'standard' | 'deep';

/** researcher.md "Domain-Specific Source Tiers": 1 = primary/official, 4 = low/excluded. */
export type SourceTier = 1 | 2 | 3 | 4;

export interface ResearchSource {
  readonly id: string;
  readonly url: string;
  readonly tier: SourceTier;
}

/** FR-P8: "HIGH-impact claims pass the Challenger before a decision may cite them." */
export type ClaimImpact = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ResearchClaim {
  readonly id: string;
  readonly text: string;
  readonly impact: ClaimImpact;
  /** IDs into the owning report's `sources` array — a claim with none fails its validator. */
  readonly citedSourceIds: readonly string[];
}

export interface ResearchReport {
  readonly id: string;
  readonly topic: string;
  readonly phase: PhaseId;
  readonly depth: ResearchDepth;
  readonly sources: readonly ResearchSource[];
  readonly claims: readonly ResearchClaim[];
  readonly generatedAt: string;
}

/** Mirrors `docs/DATABASE.md` §5's `facts` table row. */
export interface FactBankEntry {
  readonly id: string;
  readonly kind: 'research';
  readonly content: string;
  /** Citation — joined source URLs, matching the `facts.source` column's "citation" comment. */
  readonly source: string;
  readonly confidence: number;
  /** Always `true` — `fact-bank.ts` never admits an unverified claim. */
  readonly verified: true;
  readonly ticketId: string | null;
  readonly phase: PhaseId | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly useCount: number;
  readonly decayed: boolean;
}

/** Per-claim or per-report citation/citability check result shape, shared across the module. */
export interface CheckResult {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

/** Re-exported so callers only need `./types.js` for the verdict lookup shape. */
export type ClaimVerdicts = ReadonlyMap<string, ClaimVerdict>;
