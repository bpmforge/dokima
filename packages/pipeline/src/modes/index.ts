export type { ModeDefinition, ModeId, ModeStep } from './types.js';

export { NEW_PRODUCT_MODE, NEW_PRODUCT_STEPS } from './new-product.js';

export {
  ONBOARD_MODE,
  ONBOARD_SPECIALIST_ROLES,
  ONBOARD_STEPS,
  REQUIRED_ONBOARD_ARTIFACTS,
} from './onboard.js';

export {
  SECURITY_CLUSTER_SPECIALIST_ROLES,
  SECURITY_CLUSTER_STEPS,
  SECURITY_SPECIALIST_ROLES,
  SECURITY_STEPS,
  THREAT_MODEL_REFRESH_STEP,
} from './security-cluster.js';

export { buildOnboardCoverageManifest } from './coverage-manifest.js';
export type {
  AntiSlopRuleCoverageEntry,
  OnboardCoverageManifest,
  RuleLifecycleState,
  ValidatorCoverageEntry,
} from './coverage-manifest.js';

export { FEATURE_MODE, FEATURE_STEPS, decideFeatureEligibility } from './feature.js';
export type { FeatureEligibility, OnboardEvidence } from './feature.js';

export {
  DuplicateAuditFindingError,
  IMPROVE_MODE,
  IMPROVE_STEPS,
  buildFixBacklog,
  findingToTicketDraft,
  prioritizeFindings,
} from './improve.js';
export type { AuditFinding, AuditSeverity } from './improve.js';

export { MODES, UnknownModeError, getMode, macroLoopCapForMode } from './registry.js';

export {
  computeGapChecksum,
  runCoverageLoop,
  runCoverageLoopForMode,
} from './coverage-loop.js';
export type {
  CoverageLoopDeps,
  CoverageLoopIterationRecord,
  CoverageLoopResult,
  CoverageLoopStatus,
  CoverageRow,
} from './coverage-loop.js';
