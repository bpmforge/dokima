export { decompose } from './decompose.js';
export { deriveFeatures, featureGaps, UNMAPPED_FEATURE_ID } from './features.js';
export { renderProductMap } from './product-map.js';
export { deriveLanes, globOverlaps, writeScopesOverlap } from './lanes.js';
export {
  findDependencyCycles,
  findMissingPackageJsonScope,
  findUnownedInterfaces,
  findUnpathlikeWriteScope,
  lintDecomposition,
} from './linter.js';
export { renderMermaid } from './mermaid.js';
export type {
  DecomposedAcceptanceCriterion,
  Feature,
  FeatureConnection,
  FeatureGap,
  FeatureGapKind,
  DecomposedPlan,
  DecomposedTicket,
  InterfaceRef,
  LintViolation,
  LintViolationKind,
  TicketDraftInput,
  TicketDraftType,
} from './types.js';
