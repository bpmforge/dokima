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
