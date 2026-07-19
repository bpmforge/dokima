/**
 * Local port types for the pipeline orchestrator (BLUEPRINT §4, phases
 * 0–4). `runPipeline` (run-pipeline.ts) chains four already-built,
 * dependency-free engine modules (`../interview`, `../blueprint`,
 * `../decisions`, `../decompose`) into one call, but none of the prose
 * content between them is deterministic — turning a pile of interview
 * drafts into blueprint sections, or a decided blueprint into ticket-draft
 * proposals, is real LLM work. This ticket's write_scope
 * (`packages/pipeline/src/run/**` + `src/index.ts`) has no reach to
 * `@shipwright/gateway` (no new workspace import — `packages/pipeline/
 * package.json` stays dependency-free, same wall every other engine module
 * in this package documents), so every seam between phases is an injected
 * function on `PipelineModelPort` instead — the wiring ticket (W5-18) binds
 * these to real gateway calls; unit tests inject deterministic fakes.
 *
 * NA-1 (C-5/FR-N3) stays intact: `runPipeline` never drives the interview's
 * own ask/answer loop (`beginTopic`/`submitAnswer` require a `'human'`
 * `AnswerActor` it has no way to synthesize) — it takes an already-complete
 * `InterviewSession` as input, exactly as if a human had driven it through
 * `../interview/session.ts` directly over the course of a UI session before
 * this call ever happens.
 */
import type { DeliverableDraft, InterviewSession } from '../interview/types.js';
import type {
  SynthesizedBlueprint,
  SynthesizeBlueprintInput,
} from '../blueprint/synth.js';
import type { TechnicalSlate } from '../decisions/types.js';
import type { TechnicalSlateInput } from '../decisions/technical-slate.js';
import type { TicketDraftInput } from '../decompose/types.js';

/** Input to one `runPipeline` call. */
export interface RunPipelineInput {
  /** Must satisfy `isInterviewComplete` — every topic drafted or skipped. */
  readonly interviewSession: InterviewSession;
  readonly blueprintTitle: string;
  /** Current `docs/DECISIONS.md` content, for the decision-complete gate
   * (`../blueprint/gate.ts`'s `assertDecisionComplete`) to cross-check
   * resolved markers against. Empty string is valid — an empty ledger cites
   * no D-IDs, so it only blocks a blueprint that claims a RESOLVED marker. */
  readonly ledgerMarkdown: string;
}

/**
 * The three model-authored adapters between phases, plus the raw port each
 * takes the prior phase's real output — this *is* the "threading" the
 * orchestrator does, just with the prose content supplied externally
 * instead of guessed.
 */
export interface PipelineModelPort {
  /** Interview drafts -> the blueprint's condensed sections + founder-owned
   * open questions (BLUEPRINT §3.2, FR-P7). An empty `openQuestions` array
   * is a legitimate answer — a design with no unresolved founder fork. */
  readonly blueprintInputFrom: (
    drafts: readonly DeliverableDraft[],
    title: string,
  ) => SynthesizeBlueprintInput;

  /** The synthesized (decision-complete) blueprint -> the technical-fork
   * slate (R-H1) that shapes how phase 3/4 decompose the design. */
  readonly technicalSlateInputFrom: (
    blueprint: SynthesizedBlueprint,
  ) => TechnicalSlateInput;

  /** The blueprint + its decided technical slate -> raw ticket-draft
   * proposals for `../decompose`'s `decompose()` (the same "LLM specialist
   * pass" seam `decompose/types.ts` documents). */
  readonly ticketDraftsFrom: (
    blueprint: SynthesizedBlueprint,
    technicalSlate: TechnicalSlate,
  ) => readonly TicketDraftInput[];
}

/** One per completed phase in the chain, in call order — the wiring
 * ticket's `emit` appends each as an event via `@shipwright/events`
 * (Law 7); this package only defines the shape. */
export type PipelineRunEvent =
  | { readonly kind: 'interview-complete'; readonly topicCount: number }
  | { readonly kind: 'blueprint-synthesized'; readonly version: number }
  | { readonly kind: 'decisions-decided'; readonly slateTitle: string }
  | { readonly kind: 'decomposed'; readonly ticketCount: number };

export interface PipelinePort {
  readonly model: PipelineModelPort;
  readonly emit: (event: PipelineRunEvent) => void;
}
