export const PACKAGE_NAME = 'harbormaster';

export type {
  BreakpointMode,
  ClarificationRecord,
  ClarificationStatus,
  RunMode,
  RunRecord,
  RunStatus,
} from './breakpoints.js';
export {
  answerClarification,
  askClarification,
  ClarificationNotFoundError,
  ClarificationNotOpenError,
  completeRun,
  createRun,
  dismissClarification,
  getClarification,
  getRun,
  InvalidRunTransitionError,
  isTicketCheckpointed,
  listOpenClarifications,
  listRuns,
  markRunResumed,
  pauseRun,
  RunNotFoundError,
  shouldPauseAtBreakpoint,
  stopRun,
  suspendRun,
  waveOf,
} from './breakpoints.js';
export type {
  AnswerClarificationInput,
  AskClarificationInput,
  BreakpointCheckInput,
  ClarificationVerbOptions,
  CreateRunInput,
  DismissClarificationInput,
  RunVerbOptions,
} from './breakpoints.js';

/**
 * THE EXECUTION ENGINE (W10-77). Everything below was implemented and tested
 * across W3-01a/b/c and then exported from nothing: this file listed only
 * `breakpoints` and `resume`, so `runLandLoop` — the whole claim -> session ->
 * close-gate -> land path — was unreachable from `apps/server` behind an
 * exports map with a single `.` entry. Measured 2026-08-04: `run start` on a
 * build mode minted a run record and returned, because there was no legal way
 * for it to call any of this. Same build-then-wire seam as W10-72 (a UI
 * component mounted nowhere) and W10-74 (a CLI bundled into nothing), one
 * layer down and load-bearing for the product's entire premise.
 */
export { runClaimLoop, DEFAULT_MAX_SESSIONS_PER_TICKET } from './loop-claim.js';
export type {
  ClaimLoopOptions,
  ClaimLoopResult,
  ClaimLoopStopReason,
  ClaimLoopTicketOutcome,
  TicketAttempt,
} from './loop-claim.js';

export { runLandLoop } from './loop-land.js';
export type {
  LandAttempt,
  LandLoopOptions,
  LandLoopResult,
  LandLoopStopReason,
  LandLoopTicketOutcome,
  LandParkedReason,
  PushToRemotesFn,
} from './loop-land.js';

export { runCloseGate, DEFAULT_REQUIRED_VALIDATORS } from './loop-gates.js';
export type {
  CloseGateFailure,
  CloseGateOptions,
  CloseGateResult,
  CloseGateSuccess,
} from './loop-gates.js';

export { defaultHandoffBuilder, DEFAULT_VERIFY_COMMAND } from './loop-handoff.js';
export type { HandoffBuilder } from './loop-handoff.js';

export { createFileStopSwitch } from './loop-killswitch.js';
export type { StopSwitch } from './loop-killswitch.js';

export { checkClaimedTicket, resumeProject } from './resume.js';
export type {
  CheckClaimedTicketOptions,
  ClaimedTicketCheck,
  ResumeDriftEntry,
  ResumeProjectOptions,
  ResumeProjectRefusal,
  ResumeProjectResult,
  ResumeProjectSuccess,
} from './resume.js';
