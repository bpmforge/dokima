export const PACKAGE_NAME = 'pipeline';

export * from './plans/index.js';
export * from './interview/index.js';
export * from './blueprint/index.js';
export * from './decisions/index.js';
export * from './decompose/index.js';
export * from './run/index.js';
export * from './phases/index.js';

/**
 * W13-18: the adaptive-depth ceiling, exported so the server route that
 * supplies follow-ups can enforce the same bound the engine does. A limit only
 * one caller honours is not a limit.
 */
export { MAX_FOLLOWUP_DEPTH } from './interview/depth-policy.js';

/**
 * W13-55: the ux-audit judge core — NARROW, exactly what the server dispatch
 * calls, so the export ratchet gains no uncalled symbols.
 */
export {
  buildUxAuditPrompt,
  judgmentToPlanFields,
  parseUxAuditJudgments,
  verifyCitations,
} from './modes/ux-audit.js';
export type {
  DroppedJudgment,
  UxAuditJudgment,
  UxEvidenceState,
} from './modes/ux-audit.js';

/**
 * W15-03: the RALPH_WIGGUM macro coverage loop, exported for its first
 * production caller (apps/server's onboard executor). Narrow: the loop and
 * its shapes only — the rest of modes/ still has no consumer.
 */
export {
  computeGapChecksum,
  runCoverageLoop,
  runCoverageLoopForMode,
} from './modes/coverage-loop.js';
export type {
  CoverageLoopDeps,
  CoverageLoopIterationRecord,
  CoverageLoopResult,
  CoverageLoopStatus,
  CoverageRow,
} from './modes/coverage-loop.js';

/**
 * W16-05: the research path, exported for its first production caller (the
 * phase-advance research gate and the research-templates route in
 * apps/server). FR-P8/US-105 built this whole module and the barrel never
 * carried it, so "a slate citing an unchallenged HIGH claim is refused" was
 * a tested sentence with no gate behind it. NARROW: exactly what the gate
 * and route consume — the rest of research/ (fact-bank admission, template
 * table internals) still has no consumer and stays unexported per the
 * ratchet discipline.
 */
export { validateResearchReport } from './research/report.js';
export { getResearchTemplate, templatesForPhase } from './research/templates.js';
export type { ResearchTemplate } from './research/templates.js';
export type {
  CheckResult,
  ClaimVerdicts,
  ResearchClaim,
  ResearchDepth,
  ResearchReport,
  ResearchSource,
} from './research/types.js';
/** The recorded challenge artifact the gate reads verdicts from (FR-P4) — types only; `buildChallengeReport` stays unexported until a producer path exists. */
export type { ChallengeReport } from './challenger/report.js';
export type { ClaimVerdict, ClaimVerdictResult } from './challenger/claims.js';

// W23-05: the security execution graph — declared edges, measured
// applicability, and the structural validation that runs before any model or
// tool call. `runOnboard` calls `validateSecurityPlan` itself; the rest is the
// representation AB-07's scheduler consumes.
// @unreached classifySecurityApplicability: the scheduler that consumes it is W23-07 (AB-07); W23-05 declares the graph and proves the classification, and deliberately does not also build the concurrent runner.
// @unreached readySecurityNodes: same — W23-07 (AB-07) is the bounded-group scheduler that asks which nodes may start.
// @unreached skippedCategories: same — W23-07 (AB-07) hands the skipped list to the synthesis node.
// @unreached inventoryDigest: same — W23-07 (AB-07) stamps it onto the run's recorded evidence.
export {
  SECURITY_PLAN,
  classifySecurityApplicability,
  inventoryDigest,
  readySecurityNodes,
  skippedCategories,
  validateSecurityPlan,
  type ApplicabilityStatus,
  type NodeApplicability,
  type SecurityInventory,
  type SecurityPlanNode,
  type SecurityStage,
} from './modes/security-plan.js';
