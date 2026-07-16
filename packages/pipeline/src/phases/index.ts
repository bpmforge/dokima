export {
  PHASES,
  MERMAID_VALIDATOR,
  UnknownPhaseError,
  getPhase,
  isLastPhase,
  priorPhase,
  nextPhase,
} from './topology.js';
export { SoftGateNotEligibleError, assertWaiverEligible } from './waiver-policy.js';
export { decideAdvance } from './advance.js';
export type { AdvanceInput, AdvanceDeps, AdvanceResult } from './advance.js';
export { computeDownstreamStaleness } from './staleness.js';
export type { PhaseReceiptRef } from './staleness.js';
export { UnknownDeliverableError, requestRevision } from './revision.js';
export type { RequestRevisionInput, RevisionOutcome } from './revision.js';
export type {
  Deliverable,
  PhaseDefinition,
  PhaseId,
  PhaseStalenessResult,
  ReceiptVerificationResult,
  RevisionHandoff,
  RevisionRequestedEvent,
} from './types.js';
