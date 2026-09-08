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
export { DEFAULT_MAX_SESSIONS_PER_TICKET } from './loop-claim.js';

export { runLandLoop } from './loop-land.js';
// P6-11: the berths CLI applies the SAME park + idle-time feature sweep.
export { landReadyFeatures, parkLandedTicketBranch } from './loop-land-feature-run.js';
// P6-12: the decompose board-lifecycle is the features[] second writer.
export {
  FEATURE_LANDED_EVENT,
  parkedBranches,
  readBoardFeatures,
  recordBoardFeatures,
} from './loop-land-feature.js';
// P6-14: the post-merge smoke re-uses the landing's own verify derivation.
export { deriveVerifyCommand } from './verify-command.js';
export { reRunVerify } from './loop-gates-verify.js';
export type { FeatureLandingReport } from './loop-land-feature-run.js';
/**
 * W12-18: the land-loop policy types were never re-exported, so `run-build.ts`
 * could not name the `policyScope` it needs to pass — which is part of why
 * nothing ever passed one and the user's escalation choice went unread.
 */
export type {
  LandEscalationPolicy,
  ScopedLandEscalationPolicy,
} from './loop-land-policy.js';
/** W16-01: the rung->session seam apps/server composes so the ladder actually escalates the model. */
export type {
  LandFailureReceipt,
  LandRungAdvance,
  LandRungSessions,
  PolicyRung,
} from './loop-land-policy.js';
export { rungForAttempt } from './loop-land-policy.js';
/** W16-03: the rung-ZERO consult seam apps/server composes from the memory playbook. */
export type { LandR0Consult, LandR0ConsultResult } from './loop-land-rungs.js';
/** W16-04: the Forge Mirror's lifecycle-verb seam (FR-T5) — apps/server composes the forge side. */
export type { LandVerbEvent, LandVerbMirror } from './loop-land-verbs.js';
export type {
  AttemptOutcomeHook,
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
  DEFAULT_MAX_SESSION_SECONDS,
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
export type {
  SandboxProfile,
  SandboxRunOptions,
  SandboxRunResult,
} from './sandbox/types.js';

/**
 * W13-47: the watchdog, exported for the first time. Fourth instance of the
 * seam W12-04 (packer), W12-09 (code index) and W13-23 (memory anchor) each
 * hit — the implementation was complete and tested, and simply could not be
 * reached from outside the package, so it had no caller because nothing COULD
 * call it. Its own header blamed a future ticket; the barrel was the actual
 * obstacle.
 *
 * NARROW, not `export *`: the watchdog modules carry several more symbols with
 * no consumer, and re-exporting them wholesale would raise the export ratchet
 * to make one addition pass.
 */
export { createWatchdogChildProcessSpawn } from './watchdog-process.js';
// `WatchdogLimits` is deliberately NOT re-exported: nothing outside this
// package names it, and publishing it would raise the export ratchet to make
// this ticket pass — which is the one thing the ratchet's own rule forbids.
export type { WatchdogBreach } from './watchdog.js';

/** W14-03: external MCP tools in agent sessions — composed by apps/server, injected here. */
export type {
  ExternalApprovalDecision,
  ExternalToolset,
} from './agent-session/external-tools.js';

/** W21-34: what the machine review actually did to a ticket, for the surface where a person accepts it. */
export { reviewStatusFor, reviewStatusSentence } from './review-status.js';

/** W21-50: a criterion that also passes at BASE certifies nothing. */
export {
  baseProbeId,
  baseProbePath,
  BASE_PROBE_SUFFIX,
  isBaseProbeWorktree,
  unfalsifiableCriteria,
  unfalsifiableReason,
} from './loop-gates-unfalsifiable.js';
export type { UnfalsifiableCriterion } from './loop-gates-unfalsifiable.js';

/** W21-46: a rung that already failed this ticket is not re-run from scratch. */
export {
  rungMemoryFor,
  rungSkipNotice,
  startAttemptFor,
} from './loop-land-rungmemory.js';
export type { RungMemory } from './loop-land-rungmemory.js';

/** W21-40: a claim held by a run that has ended needs no waiting period. */
export {
  heldTicketsNotice,
  orphanedClaimNotice,
  orphanedClaims,
} from './loop-land-orphan.js';
export type { OrphanedClaim } from './loop-land-orphan.js';

/** W21-44: a session that made tool calls and changed nothing has not attempted the work. */
export {
  attemptedNothing,
  attemptedNothingNotice,
  latestSeq,
  parkIfAttemptedNothing,
  toolHistogramSince,
} from './loop-land-attempted.js';
export type { ToolHistogram } from './loop-land-attempted.js';

/** W21-43: a ticket whose acceptance references paths outside its scope never runs. */
export { unsatisfiableCriteria, unsatisfiableNotice } from './loop-land-satisfiable.js';

/** W21-41: the ticket's own acceptance criteria are executed by the close gate. */
export {
  humanCheckNotice,
  isExecutableCriterion,
  ranZeroTests,
  runAcceptanceCriteria,
  runGateChecks,
} from './loop-gates-acceptance.js';
export type { AcceptanceOutcome, AcceptanceRun } from './loop-gates-acceptance.js';

/** W21-37: a ticket forks from its accepted dependencies, never from an empty base. */
export { resolveTicketBase, integrationRefFor } from './loop-land-base.js';
export type { TicketBase, TicketBaseInput } from './loop-land-base.js';
export type { ReviewState, TicketReviewStatus } from './review-status.js';

/** W15-01: the review pass — cross-model verdicts over in_review tickets, composed by apps/server. */
export { DEFAULT_REVIEW_VERIFY_TIMEOUT_MS, runReviewPass } from './loop-review.js';
export type {
  ReviewOutcome,
  ReviewPassOptions,
  ReviewVerdictKind,
} from './loop-review.js';

/**
 * W16-02: the berth concurrency layer, exported for its first production
 * caller (apps/server's run-build berths path). `runBerths` was complete,
 * lane-aware, and unreachable; `landClaimedTicket` is the shared one-ticket
 * engine both it and `runLandLoop` now drive.
 */
export { berthIdOf, runBerths } from './berths.js';
export type {
  BerthOutcome,
  BerthStopReason,
  BerthTicketOutcome,
  BerthTicketRunner,
  BerthTicketRunnerInput,
  RunBerthsOptions,
  RunBerthsResult,
} from './berths.js';
export { landClaimedTicket } from './loop-land-ticket.js';

/** W17-03: the measured turns profile — observations emitted per session, multiplier computed by the composing caller. */
export { measuredTurnsMultiplier } from './agent-session/session-progress.js';
export type { TurnsObservation } from './agent-session/session-progress.js';

/** W20-09 (D-030): Otto's funnel — a total order over the founder's queue, computed never judged. */
export {
  countBlockedDependents,
  FOUNDER_ITEM_CLASSES,
  isStuckTicket,
  STUCK_CLAIM_THRESHOLD,
  orderFounderQueue,
} from './founder-queue.js';
export type {
  FounderItemClass,
  FounderQueueItem,
  OrderedFounderItem,
} from './founder-queue.js';

// W21-12: the harness-side provisioning step (the agent still cannot install).
export {
  planProvision,
  provisionWorktree,
  provisionFailureReason,
  PROVISION_TIMEOUT_MS,
  type ProvisionPlan,
  type ProvisionResult,
} from './worktree-provision.js';

// W21-19: cross-session zero-information repetition, read from the ledger.
export {
  repeatedZeroInformationCalls,
  repetitionEvidenceLine,
  CROSS_SESSION_REPEAT_THRESHOLD,
  type RepeatedCall,
} from './loop-land-repetition.js';

// W23-01: the recorded approved-build-v1 decision — what an approved build may
// do unattended, as a pure function rather than prose (W13-32's first
// acceptance criterion). Exported ahead of its caller on purpose: the runtime
// wiring is W23-02's, and the marker below is what says so out loud instead of
// letting the export sit silently unreached.
// @unreached decideApprovedBuildAction: still no production caller. W23-02 wired the APPROVAL it reads, not the per-action decision itself; the caller is W23-12 (AB-12), where a ticket's post-close path asks whether it may accept. Retargeted rather than deleted — a marker that names a ticket which has landed is a suppression nobody revisits.
// APPROVED_BUILD_POLICY_VERSION needs no marker any more: apps/server/src/cli/approved-build.ts stamps it onto every recorded approval and reads it back, which is exactly the wiring its marker promised (W23-02).
export {
  decideApprovedBuildAction,
  APPROVED_BUILD_POLICY_VERSION,
  type ApprovedBuildAction,
  type ApprovedBuildDecision,
  type ApprovedBuildFacts,
  type ApprovedBuildPolicy,
  type ApprovedBuildRequest,
  type ApprovedBuildReviewFacts,
  type ApprovedBuildSituationKind,
} from './approved-build-policy.js';

// W23-04: the security tool registry — checks that actually EXECUTE. Exported
// because both entry paths that need it live outside this package: onboard
// analysis (apps/server's pipeline) and the build's review path.
export {
  checksPermitAutomaticCompletion,
  executableIsInstalled,
  runSecurityChecks,
  sandboxedToolRunner,
  SECURITY_TOOLS,
  type CheckEvidence,
  type CheckStatus,
  type NetworkPolicy,
  type ProjectProfile,
  type SecurityToolAdapter,
  type ToolRunResult,
} from './security-checks.js';

// W23-07: the bounded-group scheduler. Generic over nodes and an injected
// execute callback — it knows nothing about security, models or routing,
// because a package may not import an app. apps/server points it at
// @dokima/pipeline's SECURITY_PLAN.
export {
  runCheckSchedule,
  type NodeOutcome,
  type NodeRecord,
  type SchedulableNode,
  type ScheduleOptions,
  type ScheduleResult,
  type SchedulerEvent,
} from './check-scheduler.js';

// W23-08: evidence keys and transitive invalidation. `invalidatedDescendants`
// is what a retry throws away; the reuse decision is used by the check runner
// and by anything that wants to know whether a stored result still describes
// the world it is about to be quoted in.
// Only `invalidatedDescendants` is published: it is the one an app needs, to
// decide what a retry throws away. The key builder and the reuse decision have
// their caller inside this package (`security-checks.ts`), and publishing a
// symbol no app calls is how the export ratchet fills up with things that are
// used perfectly well where they are.
export {
  invalidatedDescendants,
  type DependencyEdge,
  type EvidenceKeyParts,
  type ReuseDecision,
  type StoredEvidence,
} from './check-evidence.js';
