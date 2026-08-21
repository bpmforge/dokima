export const PACKAGE_NAME = 'loop';

export * from './handoff.js';
export * from './session.js';
export * from './session-scope.js';
export * from './micro-loop.js';
export * from './coverage.js';
export * from './anchors.js';
export * from './calibration.js';

/**
 * W13-09: `parseCompletionManifest` is the function that decides whether a
 * session closed a ticket, and it was reachable only from inside this package —
 * so nothing outside could test a session against the real contract without a
 * deep import (forbidden across package boundaries, TECH_STACK / law 6).
 * Exported because harbormaster's session fixtures need to assert the very
 * thing the supervised run failed on.
 */
export {
  parseCompletionManifest,
  type CompletionManifest,
  type CompletionManifestVerify,
  type ManifestParseResult,
  type ManifestParseTier,
} from './session-manifest.js';

/**
 * W13-27: the infra-failure taxonomy, exported for the first time. It was
 * complete and tested since the findings work and could not be reached across
 * the package boundary, which is exactly why it had no caller — the same seam
 * as the packer (W12-04), the code index (W12-09) and the memory anchor
 * (W13-23). NARROW, not `export *`: the findings modules carry other symbols
 * with no consumer, and re-exporting them wholesale would raise the ratchet to
 * make one addition pass.
 */
export { createInfraFailureTracker, INFRA_FAILURE_KINDS } from './findings-infra.js';
export type { InfraFailureKind, InfraFailureTracker } from './findings-infra.js';


/**
 * W15-01: the R-B2 verdict-evidence primitives, exported for the review
 * pass (harbormaster). Same seam story as W13-27 above: complete, tested,
 * unreachable across the boundary — which is why no verdict in the product
 * ever carried its required evidence line. NARROW, not `export *`.
 */
export { formatRerunLine, isValidRerun } from './findings-types.js';
export type { RerunEvidence } from './findings-types.js';
export { classifySubjectiveScore } from './loop-policy-classify.js';
export type { ReviewSignalAction } from './loop-policy-classify.js';
