/**
 * Interview/pipeline-run wire types (BLUEPRINT §12.3, FR-S4, R-M1). Mirrors
 * `@dokima/pipeline`'s `InterviewSession`/`InterviewTopic`/`TopicState`
 * (`packages/pipeline/src/interview/types.ts`) and
 * `apps/server/src/api/pipeline/pipeline-routes/index.ts`'s
 * `POST .../pipeline/run` request/response shapes — apps/web has no
 * dependency on `@dokima/pipeline` (out of this ticket's write_scope to
 * add), so this module owns its own copy rather than importing it, same
 * precedent as `apps/web/src/decisions/types.ts` (W5-14) and
 * `apps/web/src/artifacts/deliverablePhase.ts` (W5-12).
 */

export type PhaseId = 0 | 1 | 2 | 3 | 4 | 5;

export interface InterviewTopic {
  readonly phaseId: PhaseId;
  readonly deliverableId: string;
}

export interface AnswerActor {
  readonly id: string;
  readonly kind: 'human' | 'agent';
}

export interface ChatCardQuestion {
  readonly id: string;
  readonly topic: InterviewTopic;
  readonly prompt: string;
  readonly depth: number;
  readonly provenance: { readonly producingRole: 'pm-interviewer' };
}

export interface InterviewAnswer {
  readonly questionId: string;
  readonly actor: AnswerActor;
  readonly text: string;
}

export interface DeliverableDraft {
  readonly topic: InterviewTopic;
  readonly content: string;
  readonly basedOnQuestionIds: readonly string[];
}

export type TopicStatus = 'not-started' | 'in-progress' | 'skipped' | 'drafted';

export interface TopicState {
  readonly topic: InterviewTopic;
  readonly status: TopicStatus;
  readonly questionsAsked: readonly ChatCardQuestion[];
  readonly answers: readonly InterviewAnswer[];
  readonly draft: DeliverableDraft | null;
}

export interface InterviewSession {
  readonly id: string;
  readonly topics: readonly TopicState[];
  readonly activeTopicIndex: number | null;
}

/** `POST /api/v1/projects/:id/pipeline/run`'s request body. */
export interface PipelineRunRequest {
  readonly interviewSession: InterviewSession;
  readonly blueprintTitle: string;
}

export interface PlanTicket {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface PlanItemResult {
  readonly id: string;
  readonly catalog_id: string;
  readonly state: string;
  readonly ticket_id: string | null;
  readonly ticket_created: boolean;
}

/** `POST /api/v1/projects/:id/pipeline/run`'s 201 response body. */
export interface PipelineRunResult {
  readonly run_id: string;
  readonly plan: {
    readonly tickets: readonly PlanTicket[];
    readonly violations: readonly unknown[];
    readonly mermaid: string;
  };
  readonly plan_items: readonly PlanItemResult[];
}

/**
 * W10-67: the run paused on a founder decision. A 202, not an error — the
 * gate is doing its job (FR-P7) and the next step belongs to a human.
 */
export interface PipelineAwaitingDecisions {
  readonly status: 'awaiting_decisions';
  readonly run_id: string;
  readonly reasons: readonly string[];
  readonly decisions: readonly {
    readonly key: string;
    readonly slate_id: string;
    readonly title: string;
  }[];
}

/**
 * W10-58: the POST's IMMEDIATE answer. The run is a background job now, so the
 * first response says only "accepted, here is the id" — everything else arrives
 * from the status route.
 */
export interface PipelineRunAccepted {
  readonly status: 'running';
  readonly run_id: string;
}

/** One completed stage of a run, as `GET .../pipeline/runs/:runId` reports it. */
export interface PipelineRunPhase {
  readonly name: string;
  readonly at: string;
}

/** `GET /api/v1/projects/:id/pipeline/runs/:runId`. */
export interface PipelineRunStatus {
  readonly run_id: string;
  readonly status: 'running' | 'awaiting-decisions' | 'completed' | 'failed';
  readonly started_at: string;
  readonly updated_at: string;
  readonly phases: readonly PipelineRunPhase[];
  readonly result?: PipelineRunResult;
  readonly awaiting?: PipelineAwaitingDecisions;
  readonly error?: { readonly status: number; readonly body?: { readonly detail?: string } };
}

export type PipelineRunOutcome = PipelineRunResult | PipelineAwaitingDecisions;

export function isRunAccepted(value: unknown): value is PipelineRunAccepted {
  return (value as PipelineRunAccepted)?.status === 'running';
}

export function isAwaitingDecisions(
  outcome: PipelineRunOutcome,
): outcome is PipelineAwaitingDecisions {
  return (outcome as PipelineAwaitingDecisions).status === 'awaiting_decisions';
}

/** Gate receipt as `receipts-routes.ts`'s `wireReceipt` serializes it. */
export interface GateReceipt {
  readonly id: string;
  readonly kind: string;
  readonly project_id: string;
  readonly phase: number | null;
  readonly ticket_id: string | null;
  readonly validators: unknown;
  readonly input_tree_hash: string | null;
  readonly verify_command: string | null;
  readonly verify_exit: number | null;
  readonly signed_by: string | null;
  readonly payload: unknown;
  readonly created_at: string;
}
