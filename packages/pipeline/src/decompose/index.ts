export { decompose } from './decompose.js';
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
  DecomposedPlan,
  DecomposedTicket,
  InterfaceRef,
  LintViolation,
  LintViolationKind,
  TicketDraftInput,
  TicketDraftType,
} from './types.js';
