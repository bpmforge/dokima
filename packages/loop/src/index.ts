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
