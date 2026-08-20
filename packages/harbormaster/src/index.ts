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
/**
 * W12-18: the land-loop policy types were never re-exported, so `run-build.ts`
 * could not name the `policyScope` it needs to pass — which is part of why
 * nothing ever passed one and the user's escalation choice went unread.
 */
export type {
  LandEscalationPolicy,
  ScopedLandEscalationPolicy,
} from './loop-land-policy.js';
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

export {
  defaultHandoffBuilder,
  DEFAULT_VERIFY_COMMAND,
  TicketRoleRefusedError,
} from './loop-handoff.js';
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

/**
 * THE TOOL-USING TICKET SESSION (D-023, W11-02). `SpawnSession` backed by
 * `@dokima/gateway` instead of a child process — see
 * `agent-session/gateway-session.ts` for the loop and its one open gap
 * (no `tool`-role message in `ChatRequest` yet).
 */
export {
  AGENT_SESSION_SERVER_ID,
  AGENT_SESSION_TOOL_NAMES,
  AGENT_SESSION_TOOL_SCHEMAS,
  DEFAULT_AGENT_SESSION_TASK_TYPE,
  DEFAULT_AGENT_SESSION_VERIFY_TIMEOUT_MS,
  DEFAULT_MAX_TOOL_ITERATIONS,
  TOOL_COMMIT,
  TOOL_EDIT,
  TOOL_LIST,
  TOOL_READ,
  TOOL_SEARCH,
  TOOL_VERIFY,
  TOOL_WRITE,
  agentSessionToolId,
  createAgentSessionToolExecutor,
  createGatewaySpawnSession,
  ensureAgentSessionToolsRegistered,
  parseHandoffFields,
} from './agent-session/index.js';
export type {
  AgentSessionToolContext,
  AgentSessionToolName,
  EnsureRegisteredOptions,
  GatewaySpawnSessionOptions,
  HandoffFields,
} from './agent-session/index.js';

/**
 * W13-25: the sandbox, exported for the first time. It was complete and tested
 * since W6-06 and unreachable from outside the package, which is why SC-07 was
 * documented as landed and had zero callers.
 */
export { isSandboxProfileAvailable, runSandboxed } from './sandbox/index.js';
export type { SandboxProfile, SandboxRunOptions, SandboxRunResult } from './sandbox/types.js';

