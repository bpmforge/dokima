/**
 * Discovery interview types (BLUEPRINT §3.2/§4 "Discovery interview", FR-P3,
 * US-101, NA-1). Phases 0–2 are interview-driven: the pm-interviewer role
 * asks adaptive-depth questions per deliverable and drafts each deliverable
 * from the answers, rendered as chat cards (FR-C2) in the canvas.
 *
 * This module sits in the same package as `../phases` (no new workspace
 * dependency needed — sibling import, not a package-boundary crossing) and
 * reuses its `PhaseId`/topology rather than redeclaring the phase set.
 *
 * NA-1 (NEVER-AUTO — docs/research/source-system-experts.md:62, C-5):
 * interviews always pause for a human, even under `auto` autonomy mode.
 * This is enforced structurally, not by convention: `AnswerActor.kind` is
 * part of every answer/skip/resume call, `depth-policy.ts`'s
 * `assertHumanActor` refuses anything but `'human'`, and no function in this
 * directory can construct an `InterviewAnswer` on its own — it only ever
 * accepts one as caller-supplied input (same discipline as
 * `@dokima/gateway`'s `EscalationToken`: nothing here can synthesize the
 * human side of the exchange).
 */
import type { PhaseId } from '../phases/types.js';

/** One phase-0–2 deliverable the interview is responsible for drafting — mirrors `../phases/topology.ts`'s `Deliverable`, scoped to `producingRole === 'pm-interviewer'`. */
export interface InterviewTopic {
  readonly phaseId: PhaseId;
  /** Matches `Deliverable.id` (e.g. `docs/VISION.md`) so a drafted topic composes directly with `../phases/revision.ts`'s edit-invalidation path. */
  readonly deliverableId: string;
}

export interface AnswerActor {
  readonly id: string;
  readonly kind: 'human' | 'agent';
}

/** A structured chat card (FR-C2) posing one question for one topic. */
export interface ChatCardQuestion {
  readonly id: string;
  readonly topic: InterviewTopic;
  readonly prompt: string;
  /** 1 = the topic's opening question; each accepted follow-up increments this (adaptive depth, AC-1). */
  readonly depth: number;
  readonly provenance: { readonly producingRole: 'pm-interviewer' };
}

export interface InterviewAnswer {
  readonly questionId: string;
  readonly actor: AnswerActor;
  readonly text: string;
}

/**
 * The drafted deliverable content for one topic, built from its answers.
 * Once drafted, further edits are the already-built `../phases/revision.ts`
 * path (FR-C8, keyed by this same `deliverableId`) — not a re-run of the
 * interview, so this type carries no revision counter of its own.
 */
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
  /** Ordered by phase then declaration order within `../phases/topology.ts` (`topics.ts`'s `INTERVIEW_TOPICS`). */
  readonly topics: readonly TopicState[];
  /** Index into `topics` currently being asked; `null` between topics (nothing active — a fresh session, or every topic drafted/skipped). */
  readonly activeTopicIndex: number | null;
}
